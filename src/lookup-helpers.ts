import {
    type Actor,
    Object as APObject,
    type Article,
    type Collection,
    isActor,
    lookupWebFinger,
    type Note,
} from '@fedify/fedify';

import type { FedifyContext } from '@/app';
import { error, ok, type Result } from '@/core/result';

export type LookupError = 'no-links-found' | 'no-self-link' | 'lookup-error';

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
        const documentLoader = await ctx.getDocumentLoader({ handle: 'index' });
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

        const webfingerData = await lookupWebFinger(resource, {
            allowPrivateAddress:
                process.env.ALLOW_PRIVATE_ADDRESS === 'true' &&
                ['development', 'testing'].includes(process.env.NODE_ENV || ''),
        });

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
