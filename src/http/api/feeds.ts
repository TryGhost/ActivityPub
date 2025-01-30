import type { AccountService } from '../../account/account.service';
import { type AppContext, fedify } from '../../app';
import type { FeedService } from '../../feed/feed.service';
import { PostType } from '../../feed/types';
import { mapActivityToPost } from './helpers/post';
import type { Post } from './types';

/**
 * Maximum number of feed posts to return
 */
const FEED_POSTS_LIMIT = 20;

/**
 * Create a handler to handle a request for a user's feed
 *
 * @param feedService Feed service instance
 * @param accountService Account service instance
 */
export function createGetFeedHandler(
    feedService: FeedService,
    accountService: AccountService,
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

        // Validate input
        const queryType = ctx.req.query('type');
        const postType = queryType ? Number(queryType) : null;

        if (
            postType &&
            [PostType.Article, PostType.Note].includes(postType) === false
        ) {
            return new Response(null, {
                status: 400,
            });
        }

        const queryCursor = ctx.req.query('cursor');
        const cursor = queryCursor ? decodeURIComponent(queryCursor) : null;

        // Get feed items
        const { items: feedItems, nextCursor } =
            await feedService.getFeedFromKvStore(db, apCtx, {
                postType,
                limit: FEED_POSTS_LIMIT,
                cursor,
            });

        // Prepare response
        const posts: Post[] = [];

        for (const item of feedItems) {
            const post = await mapActivityToPost(item, accountService);

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
