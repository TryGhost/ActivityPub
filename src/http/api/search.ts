import { isActor } from '@fedify/fedify';

import type { AccountService } from '../../account/account.service';
import { type AppContext, fedify } from '../../app';
import {
    getFollowerCount,
    getHandle,
    isFollowedByDefaultSiteAccount,
    isHandle,
} from '../../helpers/activitypub/actor';
import { isUri } from '../../helpers/uri';
import { lookupObject } from '../../lookup-helpers';
import type { Account } from './types';

type AccountSearchResult = Pick<
    Account,
    'id' | 'name' | 'handle' | 'avatarUrl' | 'followerCount' | 'followedByMe'
>;

interface SearchResults {
    accounts: AccountSearchResult[];
}

/**
 * Create a handler to handle a search request
 *
 * @param accountService Account service instance
 */
export function createSearchHandler(accountService: AccountService) {
    /**
     * Handle a search request
     *
     * @param ctx App context instance
     */
    return async function handleSearch(ctx: AppContext) {
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

        // Init search results - At the moment we only support searching for an actor (account)
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

        // Lookup actor by handle or URI
        try {
            const actor = await lookupObject(apCtx, query);

            if (isActor(actor)) {
                results.accounts.push({
                    id: actor.id?.toString() || '',
                    name: actor.name?.toString() || '',
                    handle: getHandle(actor),
                    avatarUrl:
                        (await actor.getIcon())?.url?.href?.toString() || '',
                    followerCount: await getFollowerCount(actor),
                    followedByMe: await isFollowedByDefaultSiteAccount(
                        actor,
                        ctx.get('site'),
                        accountService,
                    ),
                });
            }
        } catch (err) {
            logger.error('Account search failed ({query}): {error}', {
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
    };
}
