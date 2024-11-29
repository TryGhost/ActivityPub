import { isActor } from '@fedify/fedify';
import type { Context } from 'hono';

import { type HonoContextVariables, fedify } from '../../../app';
import {
    getAttachments,
    getFollowerCount,
    getFollowingCount,
    getHandle,
    isFollowing,
    isHandle,
} from '../../../helpers/activitypub/actor';
import { sanitizeHtml } from '../../../helpers/sanitize';
import { lookupObject } from '../../../lookup-helpers';

interface Profile {
    actor: any;
    handle: string;
    followerCount: number;
    followingCount: number;
    isFollowing: boolean;
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
    };

    try {
        const actor = await lookupObject(apCtx, handle);

        if (!isActor(actor)) {
            return new Response(null, { status: 404 });
        }

        result.actor = await actor.toJsonLd();
        result.actor.summary = sanitizeHtml(result.actor.summary);
        result.handle = getHandle(actor);

        const [followerCount, followingCount, isFollowingResult, attachments] =
            await Promise.all([
                getFollowerCount(actor),
                getFollowingCount(actor),
                isFollowing(actor, { db }),
                getAttachments(actor, {
                    sanitizeValue: (value: string) => sanitizeHtml(value),
                }),
            ]);

        result.followerCount = followerCount;
        result.followingCount = followingCount;
        result.isFollowing = isFollowingResult;
        result.actor.attachment = attachments;
    } catch (err) {
        logger.error('Profile retrieval failed ({handle}): {error}', {
            handle,
            error: err,
        });

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
