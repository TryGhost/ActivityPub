import { isActor } from '@fedify/fedify';
import type { Context } from 'hono';

import { lookupObject } from 'lookup-helpers';
import {
    type HonoContextVariables,
    fedify,
} from '../../../app';
import {
    getAttachments,
    getFollowerCount,
    getFollowingCount,
    getHandle,
    getRecentActivities,
    isFollowing,
    isHandle,
} from '../../../helpers/activitypub/actor';
import { sanitizeHtml } from '../../../helpers/sanitize';

interface Profile {
    actor: any;
    handle: string;
    followerCount: number;
    followingCount: number;
    isFollowing: boolean;
    posts: any[];
}

export async function profileGetAction(
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
    // /profile/:handle
    const handle = ctx.req.param('handle') || '';

    // If the provided handle is invalid, return early
    if (isHandle(handle) === false) {
        return new Response(null, { status: 400 });
    }

    // Lookup actor by handle
    const result: Profile = {
        actor: {},
        handle: '',
        followerCount: 0,
        followingCount: 0,
        isFollowing: false,
        posts: [],
    };

    try {
        const actor = await lookupObject(apCtx, handle);

        if (!isActor(actor)) {
            return new Response(null, { status: 404 });
        }

        result.actor = await actor.toJsonLd();
        result.actor.summary = sanitizeHtml(result.actor.summary);
        result.actor.attachment = await getAttachments(actor, {
            sanitizeValue: (value: string) => sanitizeHtml(value)
        });
        result.handle = getHandle(actor);
        result.followerCount = await getFollowerCount(actor);
        result.followingCount = await getFollowingCount(actor);
        result.isFollowing = await isFollowing(actor, { db });
        result.posts = await getRecentActivities(actor, {
            sanitizeContent: (content: string) => sanitizeHtml(content)
        });
    } catch (err) {
        logger.error('Profile retrieval failed ({handle}): {error}', { handle, error: err });

        return new Response(null, { status: 500 });
    }

    // Return results
    return new Response(JSON.stringify(result), {
        headers: {
            'Content-Type': 'application/json',
        },
        status: 200,
    });
}
