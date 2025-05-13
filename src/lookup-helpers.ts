import {
    Object as APObject,
    type Actor,
    type Context,
    isActor,
    lookupWebFinger,
} from '@fedify/fedify';
import type { ContextData } from './app';

export async function lookupActor(
    ctx: Context<ContextData>,
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
    ctx: Context<ContextData>,
    identifier: string | URL,
) {
    let documentLoader = null;
    try {
        documentLoader = await ctx.getDocumentLoader({ identifier: 'index' });
    } catch (err) {
        ctx.data.logger.warn(
            'Could not get authenticated document loader for lookupObject',
        );
    }
    if (documentLoader === null) {
        return ctx.lookupObject(identifier);
    }
    return ctx.lookupObject(identifier, { documentLoader });
}

export async function lookupAPIdByHandle(
    ctx: Context<ContextData>,
    handle: string,
): Promise<string | null> {
    try {
        // Remove leading @ if present
        const cleanHandle = handle.startsWith('@') ? handle.slice(1) : handle;

        // Format the resource string as acct:username@domain
        const resource = `acct:${cleanHandle}`;

        const webfingerData = await lookupWebFinger(resource, {
            allowPrivateAddress:
                process.env.ALLOW_PRIVATE_ADDRESS === 'true' &&
                ['development', 'testing'].includes(process.env.NODE_ENV || ''),
        });

        if (!webfingerData?.links) {
            ctx.data.logger.info('No links found in WebFinger response');
            return null;
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
            return null;
        }

        return selfLink.href;
    } catch (err) {
        ctx.data.logger.error(
            'Error looking up actor by handle ({handle}): {error}',
            { handle, error: err },
        );
        return null;
    }
}

export async function lookupActorProfile(
    ctx: Context<ContextData>,
    handle: string,
): Promise<{ profileUrl: URL | null; apId: URL | null }> {
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
            ctx.data.logger.info(
                `No links found in WebFinger response for handle ${handle}`,
            );
            return { profileUrl: null, apId: null };
        }

        const profileLink = webfingerData.links.find(
            (link) => link.rel === 'http://webfinger.net/rel/profile-page',
        );

        let profileUrl: URL | null = null;
        if (profileLink?.href) {
            try {
                profileUrl = new URL(profileLink.href);
            } catch (err) {
                ctx.data.logger.info(
                    `Invalid profile page URL for handle ${handle}`,
                );
            }
        }

        // Get ActivityPub self link
        const selfLink = webfingerData.links.find(
            (link) =>
                link.rel === 'self' &&
                link.type === 'application/activity+json',
        );

        let apId: URL | null = null;
        if (selfLink?.href) {
            try {
                apId = new URL(selfLink.href);
            } catch (err) {
                ctx.data.logger.info(
                    `Invalid self link URL for handle ${handle}`,
                );
            }
        }

        if (!profileUrl && !apId) {
            ctx.data.logger.info(
                `No valid ActivityPub links found in WebFinger response for handle ${handle}`,
            );
        }

        return { profileUrl: profileUrl, apId: apId };
    } catch (err) {
        ctx.data.logger.error(
            `Error looking up actor profile for handle ${handle} - ${err}`,
        );
        return { profileUrl: null, apId: null };
    }
}
