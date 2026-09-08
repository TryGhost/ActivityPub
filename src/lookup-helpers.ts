import {
    type Actor,
    Object as APObject,
    type Article,
    type Collection,
    isActor,
    type Note,
} from '@fedify/vocab';
import { lookupWebFinger, type ResourceDescriptor } from '@fedify/webfinger';

import { normalizeWebfingerHost } from '@/account/utils';
import type { FedifyContext } from '@/app';
import { error, ok, type Result } from '@/core/result';
import { isLocalEnvironment } from '@/helpers/environment';

type LookupError = 'no-links-found' | 'no-self-link' | 'lookup-error';

/**
 * Outcome of resolving a remote actor's custom WebFinger handle host.
 *
 * `none` and `unavailable` are distinct so callers can tell "this actor has no
 * custom handle" from "we could not find out", and avoid clearing a stored host
 * because of a transient network failure.
 */
export type CustomWebfingerHostResolution =
    | { type: 'custom'; host: string }
    | { type: 'none' }
    | { type: 'unavailable' };

const WEBFINGER_LOOKUP_TIMEOUT_MS = 5000;

function getWebFingerLookupOptions() {
    return {
        allowPrivateAddress:
            process.env.ALLOW_PRIVATE_ADDRESS === 'true' &&
            isLocalEnvironment(process.env.NODE_ENV),
        signal: AbortSignal.timeout(WEBFINGER_LOOKUP_TIMEOUT_MS),
    };
}

export async function lookupActor(
    ctx: FedifyContext,
    url: string,
): Promise<Actor | null> {
    try {
        ctx.data.logger.info('Looking up actor locally ({url})', { url });
        const local = await ctx.data.globaldb.get([url]);
        const object = await APObject.fromJsonLd(local);
        if (isActor(object)) {
            return object;
        }
        return null;
    } catch (err) {
        ctx.data.logger.error(
            'Error looking up actor locally ({url}): {error}',
            { url, error: err },
        );
        ctx.data.logger.info('Looking up actor remotely ({url})', { url });
        const documentLoader = await ctx.getDocumentLoader({
            identifier: 'index',
        });
        try {
            const remote = await ctx.lookupObject(url, { documentLoader });
            if (isActor(remote)) {
                await ctx.data.globaldb.set([url], await remote.toJsonLd());
                return remote;
            }
        } catch (err) {
            ctx.data.logger.error(
                'Error looking up actor remotely ({url}): {error}',
                { url, error: err },
            );
            return null;
        }
    }
    return null;
}

export async function lookupObject(
    ctx: FedifyContext,
    identifier: string | URL,
) {
    let documentLoader = null;
    try {
        documentLoader = await ctx.getDocumentLoader({ identifier: 'index' });
    } catch (_err) {
        ctx.data.logger.warn(
            'Could not get authenticated document loader for lookupObject',
        );
    }
    if (documentLoader === null) {
        return ctx.lookupObject(identifier);
    }
    return ctx.lookupObject(identifier, { documentLoader });
}

export async function lookupActorProfile(
    ctx: FedifyContext,
    handle: string,
): Promise<Result<URL, LookupError>> {
    try {
        // Remove leading @ if present
        const cleanHandle = handle.startsWith('@') ? handle.slice(1) : handle;

        const resource = `acct:${cleanHandle}`;

        const webfingerData = await lookupWebFinger(
            resource,
            getWebFingerLookupOptions(),
        );

        if (!webfingerData?.links) {
            ctx.data.logger.info('No links found in WebFinger response');
            return error('no-links-found');
        }

        // Find the ActivityPub self link
        const selfLink = webfingerData.links.find(
            (link) =>
                link.rel === 'self' &&
                link.type === 'application/activity+json',
        );

        if (!selfLink?.href) {
            ctx.data.logger.info(
                'No ActivityPub self link found in WebFinger response',
            );
            return error('no-self-link');
        }

        return ok(new URL(selfLink.href));
    } catch (err) {
        ctx.data.logger.error(
            'Error looking up actor by handle ({handle}): {error}',
            { handle, error: err },
        );
        return error('lookup-error');
    }
}

/**
 * Canonical form of an actor id for WebFinger self-link comparison.
 *
 * Trailing slashes are ignored so producers that append one still match.
 * Hostnames are compared case-insensitively (URI hostnames are). `www.` is
 * not stripped: www.example.com and example.com are distinct security origins
 * and must not verify each other.
 */
function canonicalActorId(url: URL): string {
    const canonical = new URL(url.href);

    canonical.pathname = canonical.pathname.replace(/\/+$/, '');
    canonical.hostname = canonical.hostname.toLowerCase();

    return canonical.href;
}

function describesActor(webfingerData: ResourceDescriptor, apId: URL): boolean {
    const selfLink = webfingerData.links?.find(
        (link) =>
            link.rel === 'self' && link.type === 'application/activity+json',
    );

    if (!selfLink?.href) {
        return false;
    }

    try {
        return (
            canonicalActorId(new URL(selfLink.href)) === canonicalActorId(apId)
        );
    } catch {
        return false;
    }
}

/**
 * Parse an `acct:` WebFinger subject. The scheme is matched case-insensitively
 * because URI schemes are case-insensitive, even though producers emit `acct:`
 */
function parseAcctSubject(
    subject: string | undefined,
): { username: string; host: string } | null {
    if (typeof subject !== 'string') {
        return null;
    }

    const match = /^acct:([^@]+)@(.+)$/i.exec(subject.trim());
    if (!match) {
        return null;
    }

    const host = normalizeWebfingerHost(match[2]);
    if (!host) {
        return null;
    }

    return { username: match[1].toLowerCase(), host };
}

type WebfingerFetch =
    | { type: 'ok'; data: ResourceDescriptor }
    | { type: 'unavailable' };

async function fetchWebfinger(resource: string): Promise<WebfingerFetch> {
    let data: ResourceDescriptor | null;

    try {
        data = await lookupWebFinger(resource, getWebFingerLookupOptions());
    } catch {
        return { type: 'unavailable' };
    }

    if (!data) {
        return { type: 'unavailable' };
    }

    return { type: 'ok', data };
}

/**
 * Resolve a remote actor's custom WebFinger handle host.
 *
 * Custom handle domains (Mastodon `web_domain` / Ghost alternate WebFinger
 * hosts) are advertised only in the WebFinger `subject`, not on the actor
 * document, so `@user@custom.example` for an actor living on `user.example` is
 * only discoverable through WebFinger.
 *
 * A server can put any domain in its own `subject`, so a differing domain is
 * only accepted once that domain's own WebFinger points back at the same actor.
 * Without that second lookup, any instance could claim a handle on a domain it
 * does not control.
 */
export async function resolveCustomWebfingerHost(
    username: string,
    apId: URL,
): Promise<CustomWebfingerHostResolution> {
    // Lookup against the actor's actual host — do not strip `www.`. That host
    // and the apex are distinct origins; asking the apex to describe a www
    // actor (or vice versa) is not the same as verifying the actor's own
    // WebFinger. Handle comparison still uses normalizeWebfingerHost so a
    // subject of acct:user@www.example.com on a www actor reads as "no custom
    // host" rather than a custom apex claim.
    const actorLookupHost = apId.hostname.toLowerCase();
    const actorHandleHost = normalizeWebfingerHost(apId.hostname);

    if (!username || !actorLookupHost || !actorHandleHost) {
        return { type: 'none' };
    }

    const claimedLookup = await fetchWebfinger(
        `acct:${username}@${actorLookupHost}`,
    );
    if (claimedLookup.type === 'unavailable') {
        return { type: 'unavailable' };
    }

    if (!describesActor(claimedLookup.data, apId)) {
        return { type: 'none' };
    }

    const claimed = parseAcctSubject(claimedLookup.data.subject);
    if (!claimed || claimed.host === actorHandleHost) {
        return { type: 'none' };
    }

    // Callers render the handle from the actor's `preferredUsername`, so a
    // subject naming a different local-part would have us verify one handle and
    // display another. On a shared custom host that second handle can belong to
    // somebody else, who then also loses the (username, host) slot to whichever
    // row was written first.
    if (claimed.username !== username.toLowerCase()) {
        return { type: 'none' };
    }

    const confirmedLookup = await fetchWebfinger(
        `acct:${claimed.username}@${claimed.host}`,
    );
    if (confirmedLookup.type === 'unavailable') {
        return { type: 'unavailable' };
    }

    if (!describesActor(confirmedLookup.data, apId)) {
        return { type: 'none' };
    }

    const confirmed = parseAcctSubject(confirmedLookup.data.subject);
    if (
        !confirmed ||
        confirmed.host !== claimed.host ||
        confirmed.username !== claimed.username
    ) {
        return { type: 'none' };
    }

    return { type: 'custom', host: claimed.host };
}

export async function getLikeCountFromRemote(object: Note | Article) {
    let likesCollection: Collection | null;
    try {
        likesCollection = await object.getLikes();
    } catch {
        likesCollection = null;
    }

    if (!likesCollection) {
        return null;
    }

    return likesCollection.totalItems ?? null;
}

export async function getRepostCountFromRemote(object: Note | Article) {
    let sharesCollection: Collection | null;
    try {
        sharesCollection = await object.getShares();
    } catch {
        sharesCollection = null;
    }

    if (!sharesCollection) {
        return null;
    }

    return sharesCollection.totalItems ?? null;
}
