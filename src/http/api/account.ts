import type { Federation } from '@fedify/fedify';
import type { Account } from 'account/account.entity';
import type { KnexAccountRepository } from 'account/account.repository.knex';
import type {
    AccountService,
    GetFollowAccountsResult,
} from 'account/account.service';
import type { AppContext, ContextData } from 'app';
import { isHandle } from 'helpers/activitypub/actor';
import { lookupAPIdByHandle } from 'lookup-helpers';
import type { PostService } from 'post/post.service';
import {
    getAccountDTOByHandle,
    getAccountDTOFromAccount,
} from './helpers/account';
import type { AccountDTO } from './types';

/**
 * Default number of posts to return in a profile
 */
const DEFAULT_POSTS_LIMIT = 20;

/**
 * Maximum number of posts that can be returned in a profile
 */
const MAX_POSTS_LIMIT = 100;

/**
 * Create a handler to handle a request for an account
 *
 * @param accountService Account service instance
 */
export function createGetAccountHandler(
    accountService: AccountService,
    accountRepository: KnexAccountRepository,
    fedify: Federation<ContextData>,
) {
    /**
     * Handle a request for an account
     *
     * @param ctx App context
     */
    return async function handleGetAccount(ctx: AppContext) {
        const logger = ctx.get('logger');
        const site = ctx.get('site');
        let account: Account | null = null;
        const db = ctx.get('db');

        const apCtx = fedify.createContext(ctx.req.raw as Request, {
            db,
            globaldb: ctx.get('globaldb'),
            logger,
        });

        const defaultAccount = await accountRepository.getBySite(
            ctx.get('site'),
        );

        const handle = ctx.req.param('handle');
        // We are using the keyword 'me', if we want to get the account of teh current user
        if (handle === 'me') {
            account = defaultAccount;
        } else {
            if (!isHandle(handle)) {
                return new Response(null, { status: 404 });
            }

            const apId = await lookupAPIdByHandle(apCtx, handle);
            if (apId) {
                account = await accountRepository.getByApId(new URL(apId));
            }
        }

        let accountDto: AccountDTO;

        try {
            //If we found the account in our db and it's an internal account, do an internal lookup
            if (account?.isInternal) {
                accountDto = await getAccountDTOFromAccount(
                    account,
                    defaultAccount,
                    accountService,
                );
            } else {
                //Otherwise, do a remote lookup to fetch the updated data
                accountDto = await getAccountDTOByHandle(
                    handle,
                    apCtx,
                    site,
                    accountService,
                );
            }
        } catch (error) {
            logger.error('Error getting account: {error}', { error });

            return new Response(null, { status: 500 });
        }

        // Return response
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
    accountService: AccountService,
    accountRepository: KnexAccountRepository,
    fedify: Federation<ContextData>,
) {
    /**
     * Handle a request for a list of account follows
     *
     * @param ctx App context
     */
    return async function handleGetAccountFollows(ctx: AppContext) {
        const handle = ctx.req.param('handle') || '';
        if (handle === '') {
            return new Response(null, { status: 400 });
        }

        const type = ctx.req.param('type');
        if (!['following', 'followers'].includes(type)) {
            return new Response(null, { status: 400 });
        }

        const queryNext = ctx.req.query('next');
        const next = queryNext ? decodeURIComponent(queryNext) : null;

        const logger = ctx.get('logger');
        const site = ctx.get('site');
        const db = ctx.get('db');

        let account: Account | null = null;

        const apCtx = fedify.createContext(ctx.req.raw as Request, {
            db,
            globaldb: ctx.get('globaldb'),
            logger,
        });

        const defaultAccount = await accountRepository.getBySite(
            ctx.get('site'),
        );
        if (!defaultAccount || !defaultAccount.id) {
            return new Response(null, { status: 400 });
        }

        // We are using the keyword 'me', if we want to get the posts of the current user
        if (handle === 'index') {
            //Todo: change to 'me'
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

        console.log('############################# account', account);

        if (!account) {
            return new Response(null, { status: 404 });
        }

        const result: GetFollowAccountsResult = {
            accounts: [],
            next: null,
        };

        try {
            //If we found the account in our db and it's an internal account, do an internal lookup
            if (account?.isInternal) {
                console.log('############################# Internal account');
                const accountResult = await accountService.getFollowAccounts(
                    account,
                    defaultAccount,
                    Number.parseInt(next || '0'),
                    type,
                );

                result.accounts = accountResult.accounts;
                result.next = accountResult.next;
            } else {
                //Otherwise, do a remote lookup to fetch the posts
                console.log('############################# External account');
                const accountResult =
                    await accountService.getFollowsByRemoteLookUp(
                        site,
                        handle,
                        next || '',
                        type,
                    );
                if (accountResult instanceof Error) {
                    throw accountResult;
                }
                result.accounts = accountResult.accounts;
                result.next = accountResult.next;
            }
        } catch (error) {
            logger.error(`Error getting posts for ${handle}: {error}`, {
                error,
            });

            return new Response(null, { status: 500 });
        }

        console.log('############################# result', result);

        // Return response
        return new Response(
            JSON.stringify({
                accounts: result.accounts,
                next: result.next,
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
    accountService: AccountService,
    postService: PostService,
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

        const account = await accountService.getDefaultAccountForSite(
            ctx.get('site'),
        );
        const { results, nextCursor } = await postService.getPostsByAccount(
            account.id,
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
