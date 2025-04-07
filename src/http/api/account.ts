import type { Account } from 'account/account.entity';
import type { KnexAccountRepository } from 'account/account.repository.knex';
import type { AccountService } from 'account/account.service';
import { getAccountHandle } from 'account/utils';
import type { FedifyContextFactory } from 'activitypub/fedify-context.factory';
import type { AppContext } from 'app';
import { isHandle } from 'helpers/activitypub/actor';
import { lookupAPIdByHandle } from 'lookup-helpers';
import type { PostService } from 'post/post.service';
import {
    getAccountDTOByHandle,
    getAccountDTOFromAccount,
} from './helpers/account';
import type { AccountDTO } from './types';

/**
 * Maximum number of follow accounts to return
 */
const FOLLOWS_LIMIT = 20;

/**
 * Default number of posts to return in a profile
 */
const DEFAULT_POSTS_LIMIT = 20;

/**
 * Maximum number of posts that can be returned in a profile
 */
const MAX_POSTS_LIMIT = 100;

/**
 * Follow account shape - Used when returning a list of follow accounts
 */
type FollowAccount = Pick<
    AccountDTO,
    'id' | 'name' | 'handle' | 'avatarUrl'
> & { isFollowing: boolean };

/**
 * Keyword for the current user when account data is requested
 */
const CURRENT_USER_KEYWORD = 'me';

/**
 * Create a handler to handle a request for an account
 *
 * @param accountService Account service instance
 * @param accountRepository Account repository instance
 * @param fedifyContextFactory Fedify context factory instance
 */
export function createGetAccountHandler(
    accountService: AccountService,
    accountRepository: KnexAccountRepository,
    fedifyContextFactory: FedifyContextFactory,
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

        const apCtx = fedifyContextFactory.getFedifyContext();

        const handle = ctx.req.param('handle');

        if (handle !== CURRENT_USER_KEYWORD && !isHandle(handle)) {
            return new Response(null, { status: 404 });
        }

        const defaultAccount = await accountRepository.getBySite(
            ctx.get('site'),
        );

        if (handle === CURRENT_USER_KEYWORD) {
            account = defaultAccount;
        } else {
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
export function createGetAccountFollowsHandler(accountService: AccountService) {
    /**
     * Handle a request for a list of account follows
     *
     * @param ctx App context
     */
    return async function handleGetAccountFollows(ctx: AppContext) {
        const logger = ctx.get('logger');
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

        // Retrieve data
        const getAccounts =
            type === 'following'
                ? accountService.getFollowingAccounts.bind(accountService)
                : accountService.getFollowerAccounts.bind(accountService);
        const getAccountsCount =
            type === 'following'
                ? accountService.getFollowingAccountsCount.bind(accountService)
                : accountService.getFollowerAccountsCount.bind(accountService);

        // @TODO: Get account by provided handle instead of default account?
        const siteDefaultAccount =
            await accountService.getDefaultAccountForSite(site);

        // Get follows accounts and paginate
        const queryNext = ctx.req.query('next') || '0';
        const offset = Number.parseInt(queryNext);

        const results = await getAccounts(siteDefaultAccount, {
            limit: FOLLOWS_LIMIT,
            offset,
            fields: ['id', 'ap_id', 'name', 'username', 'avatar_url'],
        });
        const total = await getAccountsCount(siteDefaultAccount.id);

        const next =
            total > offset + FOLLOWS_LIMIT
                ? (offset + FOLLOWS_LIMIT).toString()
                : null;

        const accounts: FollowAccount[] = [];

        for (const result of results) {
            accounts.push({
                id: String(result.id),
                name: result.name || '',
                handle: getAccountHandle(
                    new URL(result.ap_id).host,
                    result.username,
                ),
                avatarUrl: result.avatar_url || '',
                isFollowing:
                    type === 'following'
                        ? true
                        : await accountService.checkIfAccountIsFollowing(
                              siteDefaultAccount.id,
                              result.id,
                          ),
            });
        }

        // Return response
        return new Response(
            JSON.stringify({
                accounts,
                total,
                next,
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
