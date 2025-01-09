import { type Actor, type CollectionPage, isActor } from '@fedify/fedify';
import type { Context } from 'hono';

import { type HonoContextVariables, fedify } from '../../app';
import { isFollowing, isHandle } from '../../helpers/activitypub/actor';
import { isUri } from '../../helpers/uri';
import { lookupObject } from '../../lookup-helpers';

interface FollowersResult {
    followers: {
        actor: any;
        isFollowing: boolean;
    }[];
    next: string | null;
}

/**
 * Handle a request for a profile's followers
 *
 * @param ctx {Context<{ Variables: HonoContextVariables }>} Hono context instance
 */
export async function handleGetFollowers(
    ctx: Context<{ Variables: HonoContextVariables }>,
) {
    const db = ctx.get('db');
    const logger = ctx.get('logger');
    const apCtx = fedify.createContext(ctx.req.raw as Request, {
        db,
        globaldb: ctx.get('globaldb'),
        logger,
    });

    // Parse "handle" from request parameters
    // /profile/:handle/followers
    const handle = ctx.req.param('handle') || '';

    // If the provided handle is invalid, return early
    if (!isHandle(handle)) {
        return new Response(null, { status: 400 });
    }

    // Parse "next" from query parameters
    // /profile/:handle/followers?next=<string>
    const queryNext = ctx.req.query('next') || '';
    const next = queryNext ? decodeURIComponent(queryNext) : '';

    // If the next parameter is not a valid URI, return early
    if (next !== '' && !isUri(next)) {
        return new Response(null, { status: 400 });
    }

    // Lookup actor by handle
    const actor = await lookupObject(apCtx, handle);

    if (!isActor(actor)) {
        return new Response(null, { status: 404 });
    }

    // Retrieve actor's followers
    // If a next parameter was provided, use it to retrieve a specific page of
    // followers. Otherwise, retrieve the first page of followers
    const result: FollowersResult = {
        followers: [],
        next: null,
    };

    let page: CollectionPage | null = null;

    try {
        if (next !== '') {
            // Ensure the next parameter is for the same host as the actor. We
            // do this to prevent blindly passing URIs to lookupObject (i.e next
            // param has been tampered with)
            // @TODO: Does this provide enough security? Can the host of the
            // actor be different to the host of the actor's followers collection?
            const { host: actorHost } = actor?.id || new URL('');
            const { host: nextHost } = new URL(next);

            if (actorHost !== nextHost) {
                return new Response(null, { status: 400 });
            }

            page = (await lookupObject(apCtx, next)) as CollectionPage | null;

            // Explicitly check that we have a valid page seeming though we
            // can't be type safe due to lookupObject returning a generic object
            if (!page?.itemIds) {
                page = null;
            }
        } else {
            const followers = await actor.getFollowers();

            if (followers) {
                page = await followers.getFirst();
            }
        }
    } catch (err) {
        logger.error('Error getting followers', { error: err });
    }

    if (!page) {
        return new Response(null, { status: 404 });
    }

    // Return result
    try {
        for await (const item of page.getItems()) {
            result.followers.push({
                actor: await item.toJsonLd({ format: 'compact' }),
                isFollowing: await isFollowing(item as Actor, { db }),
            });
        }
    } catch (err) {
        logger.error('Error getting followers', { error: err });
    }

    result.next = page.nextId
        ? encodeURIComponent(page.nextId.toString())
        : null;

    return new Response(JSON.stringify(result), {
        headers: {
            'Content-Type': 'application/json',
        },
        status: 200,
    });
}

interface FollowingResult {
    following: {
        actor: any;
        isFollowing: boolean;
    }[];
    next: string | null;
}

/**
 * Handle a request for a profile's following
 *
 * @param ctx {Context<{ Variables: HonoContextVariables }>} Hono context instance
 */
export async function handleGetFollowing(
    ctx: Context<{ Variables: HonoContextVariables }>,
) {
    const db = ctx.get('db');
    const logger = ctx.get('logger');
    const apCtx = fedify.createContext(ctx.req.raw as Request, {
        db,
        globaldb: ctx.get('globaldb'),
        logger,
    });

    // Parse "handle" from request parameters
    // /profile/:handle/following
    const handle = ctx.req.param('handle') || '';

    // If the provided handle is invalid, return early
    if (!isHandle(handle)) {
        return new Response(null, { status: 400 });
    }

    // Parse "next" from query parameters
    // /profile/:handle/following?next=<string>
    const queryNext = ctx.req.query('next') || '';
    const next = queryNext ? decodeURIComponent(queryNext) : '';

    // If the next parameter is not a valid URI, return early
    if (next !== '' && !isUri(next)) {
        return new Response(null, { status: 400 });
    }

    // Lookup actor by handle
    const actor = await lookupObject(apCtx, handle);

    if (!isActor(actor)) {
        return new Response(null, { status: 404 });
    }

    // Retrieve actor's following
    // If a next parameter was provided, use it to retrieve a specific page of
    // the actor's following. Otherwise, retrieve the first page of the actor's
    // following
    const result: FollowingResult = {
        following: [],
        next: null,
    };

    let page: CollectionPage | null = null;

    try {
        if (next !== '') {
            // Ensure the next parameter is for the same host as the actor. We
            // do this to prevent blindly passing URIs to lookupObject (i.e next
            // param has been tampered with)
            // @TODO: Does this provide enough security? Can the host of the
            // actor be different to the host of the actor's following collection?
            const { host: actorHost } = actor?.id || new URL('');
            const { host: nextHost } = new URL(next);

            if (actorHost !== nextHost) {
                return new Response(null, { status: 400 });
            }

            page = (await lookupObject(apCtx, next)) as CollectionPage | null;

            // Explicitly check that we have a valid page seeming though we
            // can't be type safe due to lookupObject returning a generic object
            if (!page?.itemIds) {
                page = null;
            }
        } else {
            const following = await actor.getFollowing();

            if (following) {
                page = await following.getFirst();
            }
        }
    } catch (err) {
        logger.error('Error getting following', { error: err });
    }

    if (!page) {
        return new Response(null, { status: 404 });
    }

    // Return result
    try {
        for await (const item of page.getItems()) {
            result.following.push({
                actor: await item.toJsonLd({ format: 'compact' }),
                isFollowing: await isFollowing(item as Actor, { db }),
            });
        }
    } catch (err) {
        logger.error('Error getting following', { error: err });
    }

    result.next = page.nextId
        ? encodeURIComponent(page.nextId.toString())
        : null;

    return new Response(JSON.stringify(result), {
        headers: {
            'Content-Type': 'application/json',
        },
        status: 200,
    });
}
