import type { KvStore } from '@fedify/fedify';

import type { AccountService } from '../../account/account.service';
import { getAccountHandle } from '../../account/utils';
import type { AppContext } from '../../app';
import { sanitizeHtml } from '../../helpers/html';
import type { AccountDTO, PostDTO } from './types';
import type { FeedService } from '../../feed/feed.service';

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
 * Retreive the count of posts created by the account from the database
 *
 * @param db Database instance
 */
async function getPostCount(db: KvStore) {
    const posts = await db.get<string[]>(['outbox']);

    return posts?.length || 0;
}

/**
 * Retreive the count of posts liked by the account from the database
 *
 * @param db Database instance
 */
async function getLikedCount(db: KvStore) {
    const liked = await db.get<string[]>(['liked']);

    return liked?.length || 0;
}

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
                postCount: await getPostCount(db),
                likedCount: await getLikedCount(db),
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

const DEFAULT_FEED_POSTS_LIMIT = 20;
const MAX_FEED_POSTS_LIMIT = 100;

/**
 * Create a handler to handle a request for a list of posts by an account
 *
 * @param accountService Account service instance
 */
export function createGetPostsHandler(
    accountService: AccountService,
    feedService: FeedService,
) {
    /**
     * Handle a request for a list of posts by an account
     *
     * @param ctx App context
     */
    return async function handleGetPosts(ctx: AppContext) {
        const logger = ctx.get('logger');
        const queryCursor = ctx.req.query('next');
        const cursor = queryCursor ? decodeURIComponent(queryCursor) : null;

        const queryLimit = ctx.req.query('limit');
        const limit = queryLimit
            ? Number(queryLimit)
            : DEFAULT_FEED_POSTS_LIMIT;

        if (limit > MAX_FEED_POSTS_LIMIT) {
            return new Response(null, {
                status: 400,
            });
        }

        const account = await accountService.getDefaultAccountForSite(
            ctx.get('site'),
        );

        const { results, nextCursor } =
            await feedService.getPostsByAccount(account.id, limit, cursor);

        const posts: PostDTO[] = results.map((result) => {
            return {
                id: result.post_ap_id,
                type: result.post_type,
                title: result.post_title ?? '',
                excerpt: result.post_excerpt ?? '',
                content: result.post_content ?? '',
                url: result.post_url,
                featureImageUrl: result.post_image_url ?? null,
                publishedAt: result.post_published_at,
                likeCount: result.post_like_count,
                likedByMe: result.post_liked_by_user === 1,
                replyCount: result.post_reply_count,
                readingTimeMinutes: result.post_reading_time_minutes,
                attachments: result.post_attachments
                    ? result.post_attachments.map((attachment) => ({
                          type: attachment.type ?? '',
                          mediaType: attachment.mediaType ?? '',
                          name: attachment.name ?? '',
                          url: attachment.url,
                      }))
                    : [],
                author: {
                    id: result.author_id.toString(),
                    handle: getAccountHandle(
                        result.author_url
                            ? new URL(result.author_url).host
                            : '',
                        result.author_username,
                    ),
                    name: result.author_name ?? '',
                    url: result.author_url ?? '',
                    avatarUrl: result.author_avatar_url ?? '',
                },
                authoredByMe: result.author_id === account.id,
                repostCount: result.post_repost_count,
                repostedByMe: result.post_reposted_by_user === 1,
                repostedBy: result.reposter_id
                    ? {
                          id: result.reposter_id.toString(),
                          handle: getAccountHandle(
                              result.reposter_url
                                  ? new URL(result.reposter_url).host
                                  : '',
                              result.reposter_username,
                          ),
                          name: result.reposter_name ?? '',
                          url: result.reposter_url ?? '',
                          avatarUrl: result.reposter_avatar_url ?? '',
                      }
                    : null,
            };
        });

        return new Response(
            JSON.stringify({
                posts,
                next: nextCursor,
            }),
            {
                status: 200,
            },
        );
    };
}

/*
 * Create a handler to handle a request for a list of posts liked by an account
 *
 * @param accountService Account service instance
 */
export function createGetLikedPostsHandler(
    accountService: AccountService,
    feedService: FeedService,
) {
    /**
     * Handle a request for a list of posts liked by an account
     *
     * @param ctx App context
     */
    return async function handleGetLikedPosts(ctx: AppContext) {
        const logger = ctx.get('logger');
        const queryCursor = ctx.req.query('next');
        const cursor = queryCursor ? decodeURIComponent(queryCursor) : null;

        const queryLimit = ctx.req.query('limit');
        const limit = queryLimit
            ? Number(queryLimit)
            : DEFAULT_FEED_POSTS_LIMIT;

        if (limit > MAX_FEED_POSTS_LIMIT) {
            return new Response(null, {
                status: 400,
            });
        }

        const account = await accountService.getDefaultAccountForSite(
            ctx.get('site'),
        );

        const { results, nextCursor } =
            await feedService.getPostsLikedByAccount(account.id, limit, cursor);

        const posts: PostDTO[] = results.map((result) => {
            return {
                id: result.post_ap_id,
                type: result.post_type,
                title: result.post_title ?? '',
                excerpt: result.post_excerpt ?? '',
                content: result.post_content ?? '',
                url: result.post_url,
                featureImageUrl: result.post_image_url ?? null,
                publishedAt: result.post_published_at,
                likeCount: result.post_like_count,
                likedByMe: result.post_liked_by_user === 1,
                replyCount: result.post_reply_count,
                readingTimeMinutes: result.post_reading_time_minutes,
                attachments: result.post_attachments
                    ? result.post_attachments.map((attachment) => ({
                          type: attachment.type ?? '',
                          mediaType: attachment.mediaType ?? '',
                          name: attachment.name ?? '',
                          url: attachment.url,
                      }))
                    : [],
                author: {
                    id: result.author_id.toString(),
                    handle: getAccountHandle(
                        result.author_url
                            ? new URL(result.author_url).host
                            : '',
                        result.author_username,
                    ),
                    name: result.author_name ?? '',
                    url: result.author_url ?? '',
                    avatarUrl: result.author_avatar_url ?? '',
                },
                authoredByMe: result.author_id === account.id,
                repostCount: result.post_repost_count,
                repostedByMe: result.post_reposted_by_user === 1,
                repostedBy: result.reposter_id
                    ? {
                          id: result.reposter_id.toString(),
                          handle: getAccountHandle(
                              result.reposter_url
                                  ? new URL(result.reposter_url).host
                                  : '',
                              result.reposter_username,
                          ),
                          name: result.reposter_name ?? '',
                          url: result.reposter_url ?? '',
                          avatarUrl: result.reposter_avatar_url ?? '',
                      }
                    : null,
            };
        });

        return new Response(
            JSON.stringify({
                posts,
                next: nextCursor,
            }),
            {
                status: 200,
            },
        );
    };
}
