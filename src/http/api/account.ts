import type { Federation } from '@fedify/fedify';
import type { Account } from 'account/account.entity';
import type { KnexAccountRepository } from 'account/account.repository.knex';
import type { AccountService } from 'account/account.service';
import type { FedifyContextFactory } from 'activitypub/fedify-context.factory';
import type { AppContext, ContextData } from 'app';
import { exhaustiveCheck, getError, getValue, isError } from 'core/result';
import { isHandle } from 'helpers/activitypub/actor';
import { lookupAPIdByHandle } from 'lookup-helpers';
import type { GetProfileDataResult, PostService } from 'post/post.service';
import { z } from 'zod';
import {
    getAccountDTOByHandle,
    getAccountDTOFromAccount,
} from './helpers/account';
import type { AccountDTO } from './types';
import type {
    AccountFollows,
    AccountFollowsView,
} from './views/account.follows.view';

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
    accountRepository: KnexAccountRepository,
    accountFollowsView: AccountFollowsView,
    fedifyContextFactory: FedifyContextFactory,
) {
    /**
     * Handle a request for a list of account follows
     *
     * @param ctx App context
     */
    return async function handleGetAccountFollows(ctx: AppContext) {
        const site = ctx.get('site');

        const handle = ctx.req.param('handle') || '';
        if (handle === '') {
            return new Response(null, { status: 400 });
        }

        const type = ctx.req.param('type');
        if (!['following', 'followers'].includes(type)) {
            return new Response(null, { status: 400 });
        }

        const siteDefaultAccount = await accountRepository.getBySite(site);

        const queryNext = ctx.req.query('next');
        const next = queryNext ? decodeURIComponent(queryNext) : null;

        let accountFollows: AccountFollows;

        if (handle === 'me') {
            accountFollows = await accountFollowsView.getFollowsByAccount(
                siteDefaultAccount,
                type,
                Number.parseInt(next || '0'),
                siteDefaultAccount,
            );
        } else {
            const ctx = fedifyContextFactory.getFedifyContext();
            const apId = await lookupAPIdByHandle(ctx, handle);

            if (!apId) {
                return new Response(null, { status: 400 });
            }

            const account = await accountRepository.getByApId(new URL(apId));
            if (!account) {
                return new Response(null, { status: 400 });
            }

            accountFollows = await accountFollowsView.getFollowsByHandle(
                handle,
                account,
                type,
                next,
                siteDefaultAccount,
            );
        }

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
                    defaultAccount.id,
                    defaultAccount.apId,
                    handle,
                    params.cursor || '',
                );
                if (postResult instanceof Error) {
                    throw postResult;
                }
                if (isError(postResult)) {
                    const error = getError(postResult);
                    switch (error) {
                        case 'invalid-next-parameter':
                            logger.error('Invalid next parameter');
                            return new Response(null, { status: 400 });
                        case 'not-an-actor':
                            logger.error(`Actor not found for ${handle}`);
                            return new Response(null, { status: 404 });
                        case 'error-getting-outbox':
                            logger.error(`Error getting outbox for ${handle}`);
                            return new Response(
                                JSON.stringify({
                                    posts: [],
                                    next: null,
                                }),
                                { status: 200 },
                            );
                        case 'no-page-found':
                            logger.error(
                                `No page found in outbox for ${handle}`,
                            );
                            return new Response(
                                JSON.stringify({
                                    posts: [],
                                    next: null,
                                }),
                                { status: 200 },
                            );
                        default:
                            return exhaustiveCheck(error);
                    }
                }
                const posts = getValue(postResult);
                result.results = posts.results;
                result.nextCursor = posts.nextCursor;
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

/**
 * Create a handler to handle a request for an account update
 */
export function createUpdateAccountHandler(accountService: AccountService) {
    return async function handleUpdateAccount(ctx: AppContext) {
        const schema = z.object({
            name: z.string(),
            bio: z.string(),
            username: z.string(),
            avatarUrl: z.string(),
            bannerImageUrl: z.string(),
        });

        const account = await accountService.getAccountForSite(ctx.get('site'));

        if (!account) {
            return new Response(null, { status: 404 });
        }

        let data: z.infer<typeof schema>;

        try {
            data = schema.parse((await ctx.req.json()) as unknown);
        } catch (err) {
            console.error(err);
            return new Response(JSON.stringify({}), { status: 400 });
        }

        await accountService.updateAccountProfile(account, {
            name: data.name,
            bio: data.bio,
            username: data.username,
            avatarUrl: data.avatarUrl,
            bannerImageUrl: data.bannerImageUrl,
        });

        return new Response(JSON.stringify({}), { status: 200 });
    };
}
