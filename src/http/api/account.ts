import type { KnexAccountRepository } from 'account/account.repository.knex';
import type { AccountService } from 'account/account.service';
import type { FedifyContextFactory } from 'activitypub/fedify-context.factory';
import type { AppContext } from 'app';
import { exhaustiveCheck, getError, getValue, isError } from 'core/result';
import { isHandle } from 'helpers/activitypub/actor';
import { lookupActorProfile } from 'lookup-helpers';
import { z } from 'zod';
import type { AccountDTO } from './types';
import type {
    AccountFollows,
    AccountFollowsView,
} from './views/account.follows.view';
import type {
    AccountPosts,
    AccountPostsView,
} from './views/account.posts.view';
import type { AccountView } from './views/account.view';

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
 */
export function createGetAccountHandler(
    accountView: AccountView,
    accountRepository: KnexAccountRepository,
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

        const siteDefaultAccount = await accountRepository.getBySite(
            ctx.get('site'),
        );

        let accountDto: AccountDTO | null = null;

        const viewContext = {
            requestUserAccount: siteDefaultAccount,
        };

        if (handle === CURRENT_USER_KEYWORD) {
            accountDto = await accountView.viewById(
                siteDefaultAccount.id!,
                viewContext,
            );
        } else {
            accountDto = await accountView.viewByHandle(handle, viewContext);
        }

        if (accountDto === null) {
            return new Response(null, { status: 404 });
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
    fedifyContextFactory: FedifyContextFactory,
) {
    /**
     * Handle a request for a list of account follows
     *
     * @param ctx App context
     */
    return async function handleGetAccountFollows(ctx: AppContext) {
        const logger = ctx.get('logger');
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
            const lookupResult = await lookupActorProfile(ctx, handle);

            if (isError(lookupResult)) {
                ctx.data.logger.error(
                    `Failed to lookup apId for handle: ${handle}, error: ${getError(lookupResult)}`,
                );
                return new Response(null, { status: 404 });
            }

            const apId = getValue(lookupResult);

            const account = await accountRepository.getByApId(apId);

            if (account?.isInternal) {
                accountFollows = await accountFollowsView.getFollowsByAccount(
                    account,
                    type,
                    Number.parseInt(next || '0'),
                    siteDefaultAccount,
                );
            } else {
                const result =
                    await accountFollowsView.getFollowsByRemoteLookUp(
                        apId,
                        next || '',
                        type,
                        siteDefaultAccount,
                    );
                if (isError(result)) {
                    const error = getError(result);
                    switch (error) {
                        case 'invalid-next-parameter':
                            logger.error('Invalid next parameter');
                            return new Response(null, { status: 400 });
                        case 'not-an-actor':
                            logger.error(`Actor not found for ${handle}`);
                            return new Response(null, { status: 404 });
                        case 'error-getting-follows':
                            logger.error(`Error getting follows for ${handle}`);
                            return new Response(
                                JSON.stringify({
                                    accounts: [],
                                    next: null,
                                }),
                                { status: 200 },
                            );
                        default:
                            return exhaustiveCheck(error);
                    }
                }
                accountFollows = getValue(result);
            }
        }

        // Return response
        return new Response(
            JSON.stringify({
                accounts: accountFollows?.accounts,
                next: accountFollows?.next,
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
    accountRepository: KnexAccountRepository,
    accountPostsView: AccountPostsView,
    fedifyContextFactory: FedifyContextFactory,
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
        const site = ctx.get('site');

        const handle = ctx.req.param('handle');
        if (!handle) {
            return new Response(null, { status: 400 });
        }

        const currentContextAccount = await accountRepository.getBySite(site);

        let accountPosts: AccountPosts;

        // We are using the keyword 'me', if we want to get the posts of the current user
        if (handle === 'me') {
            const accountPostsResult =
                await accountPostsView.getPostsFromOutbox(
                    currentContextAccount,
                    currentContextAccount.id,
                    params.limit,
                    params.cursor,
                );
            if (isError(accountPostsResult)) {
                const error = getError(accountPostsResult);
                switch (error) {
                    case 'not-internal-account':
                        logger.error(`Account is not internal for ${handle}`);
                        return new Response(null, { status: 500 });
                    default:
                        return exhaustiveCheck(error);
                }
            }
            accountPosts = getValue(accountPostsResult);
        } else {
            const ctx = fedifyContextFactory.getFedifyContext();
            const lookupResult = await lookupActorProfile(ctx, handle);

            if (isError(lookupResult)) {
                ctx.data.logger.error(
                    `Failed to lookup apId for handle: ${handle}, error: ${getError(lookupResult)}`,
                );
                return new Response(null, { status: 404 });
            }

            const apId = getValue(lookupResult);

            const account = await accountRepository.getByApId(apId);

            const result = await accountPostsView.getPostsByApId(
                apId,
                account,
                currentContextAccount,
                params.limit,
                params.cursor,
            );
            if (isError(result)) {
                const error = getError(result);
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
                        logger.error(`No page found in outbox for ${handle}`);
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
            accountPosts = getValue(result);
        }

        return new Response(
            JSON.stringify({
                posts: accountPosts.results,
                next: accountPosts.nextCursor,
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
    accountPostsView: AccountPostsView,
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

        const account = ctx.get('account');

        if (!account) {
            return new Response(null, { status: 404 });
        }

        const { results, nextCursor } =
            await accountPostsView.getPostsLikedByAccount(
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
