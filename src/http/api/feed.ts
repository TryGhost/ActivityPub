import type { AccountService } from '../../account/account.service';
import { type AppContext, fedify } from '../../app';
import type { FeedService } from '../../feed/feed.service';
import type { PostType } from '../../feed/types';
import { mapActivityToPost } from './helpers/post';
import type { Post } from './types';

/**
 * Default number of feed posts to return
 */
const DEFAULT_FEED_POSTS_LIMIT = 20;

/**
 * Maximum number of feed posts to return
 */
const MAX_FEED_POSTS_LIMIT = 100;

/**
 * Create a handler to handle a request for a user's feed
 *
 * @param feedService Feed service instance
 * @param accountService Account service instance
 */
export function createGetFeedHandler(
    feedService: FeedService,
    accountService: AccountService,
    postType: PostType,
) {
    /**
     * Handle a request for a user's feed
     *
     * @param ctx App context
     */
    return async function handleGetFeed(ctx: AppContext) {
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
