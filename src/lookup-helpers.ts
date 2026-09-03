import {
    type Actor,
    Object as APObject,
    type Article,
    type Collection,
    isActor,
    type Note,
} from '@fedify/vocab';
import { lookupWebFinger } from '@fedify/webfinger';

import { normalizeWebfingerHost } from '@/account/utils';
import type { FedifyContext } from '@/app';
import { error, ok, type Result } from '@/core/result';
import { isLocalEnvironment } from '@/helpers/environment';

type LookupError = 'no-links-found' | 'no-self-link' | 'lookup-error';

export type ExternalWebfingerHostResolution =
    | { type: 'custom'; host: string }
    | { type: 'default' }
    | { type: 'unavailable' };

function getWebFingerLookupOptions() {
    return {
        allowPrivateAddress:
            process.env.ALLOW_PRIVATE_ADDRESS === 'true' &&
            isLocalEnvironment(process.env.NODE_ENV),
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
 * Resolve the canonical WebFinger handle host for a remote actor.
 *
 * Custom handle domains (Mastodon `web_domain` / Ghost alternate WebFinger
 * hosts) are advertised only in the WebFinger `subject`, not on the actor
 * document. Looking up `acct:{username}@{apId.host}` and reading the subject
 * host is how remotes discover `@user@custom.example` when the actor lives at
 * `user.example`.
 *
 * Returns:
 * - `custom` when the subject host differs from the actor host
 * - `default` when WebFinger confirms the actor host is canonical
 * - `unavailable` when WebFinger cannot be resolved or does not verify the actor
 */
export async function resolveExternalWebfingerHost(
    username: string,
    apId: URL,
): Promise<ExternalWebfingerHostResolution> {
    if (!username) {
        return { type: 'unavailable' };
    }

    const actorHost = normalizeWebfingerHost(apId.host);
    if (!actorHost) {
        return { type: 'unavailable' };
    }

    try {
        const webfingerData = await lookupWebFinger(
            `acct:${username}@${actorHost}`,
            getWebFingerLookupOptions(),
        );

        if (!webfingerData?.links) {
            return { type: 'unavailable' };
        }

        const selfLink = webfingerData.links.find(
            (link) =>
                link.rel === 'self' &&
                link.type === 'application/activity+json',
        );

        if (!selfLink?.href) {
            return { type: 'unavailable' };
        }

        let selfUrl: URL;
        try {
            selfUrl = new URL(selfLink.href);
        } catch {
            return { type: 'unavailable' };
        }

        if (selfUrl.href !== apId.href) {
            // Tolerate trailing-slash / www differences that still refer to the
            // same actor document.
            const normalizedSelf = new URL(selfUrl.href);
            const normalizedApId = new URL(apId.href);
            normalizedSelf.pathname = normalizedSelf.pathname.replace(
                /\/+$/,
                '',
            );
            normalizedApId.pathname = normalizedApId.pathname.replace(
                /\/+$/,
                '',
            );
            normalizedSelf.host =
                normalizeWebfingerHost(normalizedSelf.host) ??
                normalizedSelf.host;
            normalizedApId.host =
                normalizeWebfingerHost(normalizedApId.host) ??
                normalizedApId.host;

            if (normalizedSelf.href !== normalizedApId.href) {
                return { type: 'unavailable' };
            }
        }

        if (
            typeof webfingerData.subject !== 'string' ||
            !webfingerData.subject.startsWith('acct:')
        ) {
            return { type: 'default' };
        }

        const subjectParts = webfingerData.subject
            .slice('acct:'.length)
            .split('@');
        if (subjectParts.length !== 2 || !subjectParts[1]) {
            return { type: 'default' };
        }

        const subjectHost = normalizeWebfingerHost(subjectParts[1]);
        if (!subjectHost) {
            return { type: 'default' };
        }

        if (subjectHost === actorHost) {
            return { type: 'default' };
        }

        return { type: 'custom', host: subjectHost };
    } catch {
        return { type: 'unavailable' };
    }
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
