import * as Sentry from '@sentry/node';

import type { AppContext } from '@/app';
import type { FeedService, FeedType } from '@/feed/feed.service';
import { APIRoute, RequireRoles } from '@/http/decorators/route.decorator';
import { GhostRole } from '@/http/middleware/role-guard';
import type { PostInteractionCountsService } from '@/post/post-interaction-counts.service';
import { feedResultToPostDTO } from './helpers/feed';

/**
 * Default number of posts to return in a feed
 */
const DEFAULT_FEED_POSTS_LIMIT = 20;

/**
 * Maximum number of posts that can be returned in a feed
 */
const MAX_FEED_POSTS_LIMIT = 100;

/**
 * Controller for feed-related operations
 */
export class FeedController {
    constructor(
        private readonly feedService: FeedService,
        private readonly postInteractionCountsService: PostInteractionCountsService,
    ) {}

    @APIRoute('GET', 'feed/notes')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
    async getNotesFeed(ctx: AppContext) {
        return this.handleGetFeed(ctx, 'Feed');
    }

    @APIRoute('GET', 'feed/reader')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
    async getReaderFeed(ctx: AppContext) {
        return this.handleGetFeed(ctx, 'Inbox');
    }

    private async handleGetFeed(ctx: AppContext, feedType: FeedType) {
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

        const { results, nextCursor } = await this.feedService.getFeedData({
            accountId: account.id,
            feedType,
            limit,
            cursor,
        });

        const posts = feedResultToPostDTO(results, account);

        // Request an update of the interaction counts for the posts in the
        // feed - We do not await this as we do not want to increase the
        // response time of the request
        this.postInteractionCountsService
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
    }
}
