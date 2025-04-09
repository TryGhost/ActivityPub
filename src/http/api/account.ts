import type { Federation } from '@fedify/fedify';
import type { Account } from 'account/account.entity';
import type { KnexAccountRepository } from 'account/account.repository.knex';
import type { AccountService } from 'account/account.service';
import type { FedifyContextFactory } from 'activitypub/fedify-context.factory';
import type { AppContext, ContextData } from 'app';
import { isHandle } from 'helpers/activitypub/actor';
import type { Knex } from 'knex';
import { lookupAPIdByHandle } from 'lookup-helpers';
import type { GetProfileDataResult, PostService } from 'post/post.service';
import type { AccountDTO } from './types';
import type { AccountFollowsView } from './views/account.follows.view';
import AccountView from './views/account.view';

/**
 * Default number of posts to return in a profile
 */
const DEFAULT_POSTS_LIMIT = 20;

/**
 * Maximum number of posts that can be returned in a profile
 */
const MAX_POSTS_LIMIT = 100;

/**
 * Keyword to indicate a request is for the current user
 */
const CURRENT_USER_KEYWORD = 'me';

/**
 * Create a handler to handle a request for an account
 *
 * @param db Database client
 * @param fedifyContextFactory Fedify context factory instance
 */
export function createGetAccountHandler(
    db: Knex,
    fedifyContextFactory: FedifyContextFactory,
) {
    /**
     * Handle a request for an account
     *
     * @param ctx App context
     */
    return async function handleGetAccount(ctx: AppContext) {
        const handle = ctx.req.param('handle');

        if (handle !== CURRENT_USER_KEYWORD && !isHandle(handle)) {
            return new Response(null, { status: 404 });
        }

        let accountDto: AccountDTO | null = null;

        const accountView = new AccountView(db, fedifyContextFactory);

        if (handle === CURRENT_USER_KEYWORD) {
            accountDto = await accountView.viewBySite(ctx.get('site'));
        } else {
            accountDto = await accountView.viewByHandle(handle, {
                site: ctx.get('site'),
            });
        }

        return new Response(JSON.stringify(accountDto), {
            headers: {
                'Content-Type': 'application/json',
            },
            status: 200,
        });
    };
}

/**
 * Create a handler to handle a request for a list of account follows
 *
 * @param accountService Account service instance
 */
export function createGetAccountFollowsHandler(
    accountRepository: KnexAccountRepository,
    accountFollowsView: AccountFollowsView,
) {
    /**
     * Handle a request for a list of account follows
     *
     * @param ctx App context
     */
    return async function handleGetAccountFollows(ctx: AppContext) {
        const site = ctx.get('site');

        // Validate input
        const handle = ctx.req.param('handle') || '';

        if (handle === '') {
            return new Response(null, { status: 400 });
        }

        const type = ctx.req.param('type');

        if (!['following', 'followers'].includes(type)) {
            return new Response(null, { status: 400 });
        }

        const siteDefaultAccount = await accountRepository.getBySite(site);

        // Get follows accounts and paginate
        const queryNext = ctx.req.query('next') || '0';
        const offset = Number.parseInt(queryNext);

        const accountFollows = await accountFollowsView.getFollows(
            type,
            siteDefaultAccount,
            offset,
        );

        // Return response
        return new Response(
            JSON.stringify({
                accounts: accountFollows.accounts,
                total: accountFollows.total,
                next: accountFollows.next,
            }),
            {
                headers: {
                    'Content-Type': 'application/json',
                },
                status: 200,
            },
        );
    };
}

/**
 * Validates and extracts pagination parameters from the request
 *
 * @param ctx App context
 * @returns Object containing cursor and limit, or null if invalid
 */
function validateRequestParams(ctx: AppContext) {
    const queryCursor = ctx.req.query('next');
    const cursor = queryCursor ? decodeURIComponent(queryCursor) : null;

    const queryLimit = ctx.req.query('limit');
    const limit = queryLimit ? Number(queryLimit) : DEFAULT_POSTS_LIMIT;

    if (limit > MAX_POSTS_LIMIT) {
        return null;
    }

    return { cursor, limit };
}

/**
 * Create a handler to handle a request for a list of posts by an account
 *
 * @param accountService Account service instance
 * @param profileService Profile service instance
 */
export function createGetAccountPostsHandler(
    postService: PostService,
    accountRepository: KnexAccountRepository,
    fedify: Federation<ContextData>,
) {
    /**
     * Handle a request for a list of posts by an account
     *
     * @param ctx App context
     */
    return async function handleGetPosts(ctx: AppContext) {
        const params = validateRequestParams(ctx);
        if (!params) {
            return new Response(null, { status: 400 });
        }

        const logger = ctx.get('logger');
        let account: Account | null = null;
        const db = ctx.get('db');

        const apCtx = fedify.createContext(ctx.req.raw as Request, {
            db,
            globaldb: ctx.get('globaldb'),
            logger,
        });

        const handle = ctx.req.param('handle');
        if (!handle) {
            return new Response(null, { status: 400 });
        }

        const defaultAccount = await accountRepository.getBySite(
            ctx.get('site'),
        );

        if (!defaultAccount || !defaultAccount.id) {
            return new Response(null, { status: 400 });
        }

        // We are using the keyword 'me', if we want to get the posts of the current user
        if (handle === 'me') {
            account = defaultAccount;
        } else {
            if (!isHandle(handle)) {
                return new Response(null, { status: 400 });
            }

            const apId = await lookupAPIdByHandle(apCtx, handle);
            if (apId) {
                account = await accountRepository.getByApId(new URL(apId));
            }
        }

        const result: GetProfileDataResult = {
            results: [],
            nextCursor: null,
        };

        try {
            //If we found the account in our db and it's an internal account, do an internal lookup
            if (account?.isInternal && account.id) {
                const postResult = await postService.getPostsByAccount(
                    account.id,
                    defaultAccount.id,
                    params.limit,
                    params.cursor,
                );

                result.results = postResult.results;
                result.nextCursor = postResult.nextCursor;
            } else {
                //Otherwise, do a remote lookup to fetch the posts
                const postResult = await postService.getPostsByRemoteLookUp(
                    defaultAccount,
                    handle,
                    params.cursor || '',
                );
                if (postResult instanceof Error) {
                    throw postResult;
                }
                result.results = postResult.results;
                result.nextCursor = postResult.nextCursor;
            }
        } catch (error) {
            logger.error(`Error getting posts for ${handle}: {error}`, {
                error,
            });

            return new Response(null, { status: 500 });
        }

        return new Response(
            JSON.stringify({
                posts: result.results,
                next: result.nextCursor,
            }),
            { status: 200 },
        );
    };
}

/**
 * Create a handler to handle a request for a list of posts liked by an account
 *
 * @param accountService Account service instance
 * @param profileService Profile service instance
 */
export function createGetAccountLikedPostsHandler(
    accountService: AccountService,
    postService: PostService,
) {
    /**
     * Handle a request for a list of posts liked by an account
     *
     * @param ctx App context
     */
    return async function handleGetLikedPosts(ctx: AppContext) {
        const params = validateRequestParams(ctx);
        if (!params) {
            return new Response(null, { status: 400 });
        }

        const account = await accountService.getDefaultAccountForSite(
            ctx.get('site'),
        );

        if (!account) {
            return new Response(null, { status: 404 });
        }

        const { results, nextCursor } =
            await postService.getPostsLikedByAccount(
                account.id,
                params.limit,
                params.cursor,
            );

        return new Response(
            JSON.stringify({
                posts: results,
                next: nextCursor,
            }),
            { status: 200 },
        );
    };
}
