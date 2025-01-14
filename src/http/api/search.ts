import { isActor } from '@fedify/fedify';

import { type AppContext, fedify } from '../../app';
import {
    getAttachments,
    getFollowerCount,
    getFollowingCount,
    getHandle,
    isFollowedBy,
    isFollowing,
    isHandle,
} from '../../helpers/activitypub/actor';
import { sanitizeHtml } from '../../helpers/html';
import { isUri } from '../../helpers/uri';
import { lookupObject } from '../../lookup-helpers';
import type { Account } from './types';

interface SearchResults {
    accounts: Account[];
}

/**
 * Handle a search request
 *
 * @param ctx App context instance
 */
export async function handleSearch(ctx: AppContext) {
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

    // Init search results - At the moment we only support searching for actors (accounts)
    const results: SearchResults = {
        accounts: [],
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

    // Lookup actor by query
    try {
        const actor = await lookupObject(apCtx, query);

        if (isActor(actor)) {
            const result: Account = {
                id: actor.id?.href || null,
                name: actor.name?.toString() || null,
                handle: getHandle(actor),
                bio: sanitizeHtml(actor.summary?.toString() || ''),
                url: actor.url?.href?.toString() || null,
                avatarUrl: (await actor.getIcon())?.url?.toString() || null,
                bannerUrl: (await actor.getImage())?.url?.toString() || null,
                customFields: (
                    await getAttachments(actor, {
                        sanitizeValue: (value: string) => sanitizeHtml(value),
                    })
                ).reduce((acc: Record<string, string>, attachment) => {
                    acc[attachment.name] = attachment.value;

                    return acc;
                }, {}),
                followingCount: await getFollowingCount(actor),
                followerCount: await getFollowerCount(actor),
                followsMe: await isFollowedBy(actor, { db }),
                followedByMe: await isFollowing(actor, { db }),
            };

            results.accounts.push(result);
        }
    } catch (err) {
        logger.error('Account search failed: {error}', {
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
