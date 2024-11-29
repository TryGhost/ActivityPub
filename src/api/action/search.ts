import { isActor } from '@fedify/fedify';
import type { Context } from 'hono';

import { type HonoContextVariables, fedify } from '../../app';
import {
    getAttachments,
    getFollowerCount,
    getFollowingCount,
    getHandle,
    isFollowing,
    isHandle,
} from '../../helpers/activitypub/actor';
import { sanitizeHtml } from '../../helpers/sanitize';
import { isUri } from '../../helpers/uri';
import { lookupObject } from '../../lookup-helpers';

interface ProfileSearchResult {
    actor: any;
    handle: string;
    followerCount: number;
    followingCount: number;
    isFollowing: boolean;
}

interface SearchResults {
    profiles: ProfileSearchResult[];
}

export async function searchAction(
    ctx: Context<{ Variables: HonoContextVariables }>,
) {
    const db = ctx.get('db');
    const logger = ctx.get('logger');
    const apCtx = fedify.createContext(ctx.req.raw as Request, {
        db,
        globaldb: ctx.get('globaldb'),
        logger,
    });

    // Parse "query" from query parameters
    // ?query=<string>
    const queryQuery = ctx.req.query('query');
    const query = queryQuery ? decodeURIComponent(queryQuery) : '';

    // Init search results - At the moment we only support searching for an actor (profile)
    const results: SearchResults = {
        profiles: [],
    };

    // If the query is not a handle or URI, return early
    if (isHandle(query) === false && isUri(query) === false) {
        return new Response(JSON.stringify(results), {
            headers: {
                'Content-Type': 'application/json',
            },
            status: 200,
        });
    }

    // Lookup actor by handle or URI
    try {
        const actor = await lookupObject(apCtx, query);

        if (isActor(actor)) {
            const result: ProfileSearchResult = {
                actor: {},
                handle: '',
                followerCount: 0,
                followingCount: 0,
                isFollowing: false,
            };

            result.actor = await actor.toJsonLd();

            result.actor.summary = sanitizeHtml(result.actor.summary);
            result.actor.attachment = await getAttachments(actor, {
                sanitizeValue: (value: string) => sanitizeHtml(value),
            });
            result.handle = getHandle(actor);
            result.followerCount = await getFollowerCount(actor);
            result.followingCount = await getFollowingCount(actor);
            result.isFollowing = await isFollowing(actor, { db });

            results.profiles.push(result);
        }
    } catch (err) {
        logger.error('Profile search failed ({query}): {error}', {
            query,
            error: err,
        });
    }

    // Return results
    return new Response(JSON.stringify(results), {
        headers: {
            'Content-Type': 'application/json',
        },
        status: 200,
    });
}
