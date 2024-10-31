import type { Context } from 'hono';

import {
    type HonoContextVariables,
    fedify,
} from '../../app';
import { getActivityChildren, getActivityParents } from '../../db';
import { buildActivity } from '../../helpers/activitypub/activity';
import { isUri } from '../../helpers/uri';

interface ActivityJsonLd {
    [key: string]: any;
}

export async function getActivityThreadAction(
    ctx: Context<{ Variables: HonoContextVariables }>,
) {
    const db = ctx.get('db');
    const globaldb = ctx.get('globaldb');
    const logger = ctx.get('logger');
    const apCtx = fedify.createContext(ctx.req.raw as Request, {db, globaldb, logger});

    // Parse "activity_id" from request parameters
    // /thread/:activity_id
    const activityIdParam = ctx.req.param('activity_id')
    const activityId = activityIdParam ? Buffer.from(activityIdParam, 'base64url').toString('utf-8') : '';

    // If the provided activityId is invalid, return early
    if (isUri(activityId) === false) {
        return new Response(null, { status: 400 });
    }

    const activityJsonLd = await globaldb.get<ActivityJsonLd>([activityId]);

    // If the activity can not be found, return early
    if (activityJsonLd === undefined) {
        return new Response(null, { status: 404 });
    }

    const items: ActivityJsonLd[] = [activityJsonLd];

    // If the object is a string, fetch the object from the database. We need to
    // do this because we need the inReplyTo property of the object to find the
    // parent(s) and children of the activity
    if (typeof activityJsonLd.object === 'string') {
        const object = await globaldb.get<ActivityJsonLd>([activityJsonLd.object]);

        if (object) {
            activityJsonLd.object = object;
        }
    }

    // Find children (replies) and append to the thread
    const children = await getActivityChildren(activityJsonLd);
    items.push(...children);

    // Find parent(s) and prepend to the thread
    const parents = await getActivityParents(activityJsonLd);
    items.unshift(...parents);

    // Build the activities so that they have all the data expected by the client
    const likedRefs = (await db.get<string[]>(['liked'])) || [];
    const builtActivities = await Promise.all(
        items.map(item =>
            buildActivity(item.id, globaldb, apCtx, likedRefs, true),
        ),
    );

    // Return the response
    return new Response(JSON.stringify({
        items: builtActivities,
    }), {
        headers: {
            'Content-Type': 'application/json',
        },
        status: 200,
    });
}
