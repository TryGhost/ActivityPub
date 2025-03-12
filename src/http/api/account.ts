import type { AccountService } from '../../account/account.service';
import { getAccountHandle } from '../../account/utils';
import type { AppContext } from '../../app';
import { sanitizeHtml } from '../../helpers/html';
import type { AccountDTO } from './types';

/**
 * Maximum number of follow accounts to return
 */
const FOLLOWS_LIMIT = 20;

/**
 * Follow account shape - Used when returning a list of follow accounts
 */
type FollowAccount = Pick<
    AccountDTO,
    'id' | 'name' | 'handle' | 'avatarUrl'
> & { isFollowing: boolean };

/**
 * Create a handler to handle a request for an account
 *
 * @param accountService Account service instance
 */
export function createGetAccountHandler(accountService: AccountService) {
    /**
     * Handle a request for an account
     *
     * @param ctx App context
     */
    return async function handleGetAccount(ctx: AppContext) {
        const logger = ctx.get('logger');
        const site = ctx.get('site');

        // Validate input
        const handle = ctx.req.param('handle') || '';

        if (handle === '') {
            return new Response(null, { status: 400 });
        }

        const db = ctx.get('db');
        let accountDto: AccountDTO;

        const account = await accountService.getDefaultAccountForSite(site);

        if (!account) {
            return new Response(null, { status: 404 });
        }

        try {
            accountDto = {
                /**
                 * At the moment we don't have an internal ID for Ghost accounts so
                 * we use Fediverse ID
                 */
                id: account.ap_id,
                name: account.name || '',
                handle: getAccountHandle(site.host, account.username),
                bio: sanitizeHtml(account.bio || ''),
                url: account.url || '',
                avatarUrl: account.avatar_url || '',
                /**
                 * At the moment we don't support banner images for Ghost accounts
                 */
                bannerImageUrl: account.banner_image_url,
                /**
                 * At the moment we don't support custom fields for Ghost accounts
                 */
                customFields: {},
                postCount: await accountService.getPostCount(account),
                likedCount: await accountService.getLikedCount(account),
                followingCount:
                    await accountService.getFollowingAccountsCount(account),
                followerCount:
                    await accountService.getFollowerAccountsCount(account),
                /**
                 * At the moment we only expect to be returning the account for
                 * the current user, so we can hardcode these values to false as
                 * the account cannot follow, or be followed by itself
                 */
                followsMe: false,
                followedByMe: false,
            };
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
        const total = await getAccountsCount(siteDefaultAccount);

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
                              siteDefaultAccount,
                              result,
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
