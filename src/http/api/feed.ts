import * as Sentry from '@sentry/node';

import type { PostInteractionCountsService } from 'post/post-interaction-counts.service';
import type { AccountService } from '../../account/account.service';
import { getAccountHandle } from '../../account/utils';
import type { AppContext } from '../../app';
import type { FeedService, FeedType } from '../../feed/feed.service';
import type { PostDTO } from './types';

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
    postInteractionCountsService: PostInteractionCountsService,
    feedType: FeedType,
) {
    /**
     * Handle a request for a user's feed
     *
     * @param ctx App context
     */
    return async function handleGetFeed(ctx: AppContext) {
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

        const account = ctx.get('account');

        const { results, nextCursor } = await feedService.getFeedData({
            accountId: account.id,
            feedType,
            limit,
            cursor,
        });

        const posts: PostDTO[] = results.map((result) => {
            return {
                id: result.post_ap_id,
                type: result.post_type,
                title: result.post_title ?? '',
                excerpt: result.post_excerpt ?? '',
                summary: result.post_summary ?? null,
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

        // Request an update of the interaction counts for the posts in the
        // feed - We do not await this as we do not want to increase the
        // response time of the request
        postInteractionCountsService
            .requestUpdate(
                ctx.get('site').host,
                results.map((post) => post.post_id),
            )
            .catch((error) => {
                Sentry.captureException(error);

                ctx.get('logger').error(
                    'Error requesting update of interaction counts for posts {error}',
                    { error },
                );
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
