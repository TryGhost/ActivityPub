import { PostType } from 'post/post.entity';
import type { AccountService } from '../../account/account.service';
import { getAccountHandle } from '../../account/utils';
import { type AppContext, fedify } from '../../app';
import type { FeedService, FeedType } from '../../feed/feed.service';
import { mapActivityToPost } from './helpers/post';
import type { Post } from './types';

/**
 * Default number of posts to return in a feed
 */
const DEFAULT_FEED_POSTS_LIMIT = 20;

/**
 * Maximum number of posts that can be returned in a feed
 */
const MAX_FEED_POSTS_LIMIT = 100;

/**
 * Create a handler to handle a request for a user's feed
 *
 * @param feedService Feed service instance
 * @param accountService Account service instance
 * @param feedType Type of feed
 */
export function createGetFeedHandler(
    feedService: FeedService,
    accountService: AccountService,
    feedType: FeedType,
) {
    /**
     * Handle a request for a user's feed
     *
     * @param ctx App context
     */
    return async function handleGetFeed(ctx: AppContext) {
        if (['development', 'testing'].includes(process.env.NODE_ENV ?? '')) {
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

            const { results, nextCursor } = await feedService.getFeedData({
                accountId: account.id,
                feedType,
                limit,
                cursor,
            });

            const posts: Post[] = results.map((result) => {
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
                    attachments: [], // TODO
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
        }

        const postType =
            feedType === 'Inbox' ? PostType.Article : PostType.Note;

        const db = ctx.get('db');
        const globaldb = ctx.get('globaldb');
        const logger = ctx.get('logger');
        const apCtx = fedify.createContext(ctx.req.raw, {
            db,
            globaldb,
            logger,
        });

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

        // Get feed items
        const { items: feedItems, nextCursor } =
            await feedService.getFeedFromKvStore(db, apCtx, {
                postType,
                limit,
                cursor,
            });

        // Prepare response
        const posts: Post[] = [];

        for (const item of feedItems) {
            const post = await mapActivityToPost(item, accountService, apCtx);

            if (post) {
                posts.push(post);
            }
        }

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
