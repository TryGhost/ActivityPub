import { chunk } from 'es-toolkit';
import type { Knex } from 'knex';

import {
    type FollowersOnlyPost,
    type Post,
    PostType,
    type PublicPost,
} from 'post/post.entity';

export type FeedType = 'Inbox' | 'Feed';

export interface GetFeedDataOptions {
    /**
     * ID of the account associated with the user to get the feed for
     */
    accountId: number;
    /**
     * Type of feed to get
     */
    feedType: FeedType;
    /**
     * Maximum number of posts to return
     */
    limit: number;
    /**
     * Cursor to use for pagination
     */
    cursor: string | null;
}

interface BaseGetFeedDataResultRow {
    post_id: number;
    post_type: PostType;
    post_title: string | null;
    post_excerpt: string | null;
    post_content: string | null;
    post_url: string;
    post_image_url: string | null;
    post_published_at: Date;
    post_like_count: number;
    post_liked_by_user: 0 | 1;
    post_reply_count: number;
    post_reading_time_minutes: number;
    post_repost_count: number;
    post_reposted_by_user: 0 | 1;
    post_ap_id: string;
    post_attachments: {
        type: string | null;
        mediaType: string | null;
        name: string | null;
        url: string;
    }[];
    author_id: number;
    author_name: string | null;
    author_username: string;
    author_url: string | null;
    author_avatar_url: string | null;
}

interface GetFeedDataResultRowReposted extends BaseGetFeedDataResultRow {
    reposter_id: number;
    reposter_name: string | null;
    reposter_username: string;
    reposter_url: string | null;
    reposter_avatar_url: string | null;
}

interface GetFeedDataResultRowWithoutReposted extends BaseGetFeedDataResultRow {
    reposter_id: null;
    reposter_name: null;
    reposter_username: null;
    reposter_url: null;
    reposter_avatar_url: null;
}

export type GetFeedDataResultRow =
    | GetFeedDataResultRowReposted
    | GetFeedDataResultRowWithoutReposted;

export interface GetFeedDataResult {
    results: GetFeedDataResultRow[];
    nextCursor: string | null;
}

export class FeedService {
    /**
     * @param db Database client
     */
    constructor(private readonly db: Knex) {}

    /**
     * Get data for a feed based on the provided options
     *
     * @param options Options for the query
     */
    async getFeedData(options: GetFeedDataOptions): Promise<GetFeedDataResult> {
        let postType: PostType = PostType.Article;

        if (options.feedType === 'Feed') {
            postType = PostType.Note;
        }

        const { id: userId } = await this.db('users')
            .where('account_id', options.accountId)
            .select('id')
            .first();

        const query = this.db('feeds')
            .select(
                // Post fields
                'posts.id as post_id',
                'posts.type as post_type',
                'posts.title as post_title',
                'posts.excerpt as post_excerpt',
                'posts.content as post_content',
                'posts.url as post_url',
                'posts.image_url as post_image_url',
                'posts.published_at as post_published_at',
                'posts.like_count as post_like_count',
                this.db.raw(`
                    CASE
                        WHEN likes.account_id IS NOT NULL THEN 1
                        ELSE 0
                    END AS post_liked_by_user
                `),
                'posts.reply_count as post_reply_count',
                'posts.reading_time_minutes as post_reading_time_minutes',
                'posts.attachments as post_attachments',
                'posts.repost_count as post_repost_count',
                this.db.raw(`
                    CASE
                        WHEN reposts.account_id IS NOT NULL THEN 1
                        ELSE 0
                    END AS post_reposted_by_user
                `),
                'posts.ap_id as post_ap_id',
                // Author fields
                'author_account.id as author_id',
                'author_account.name as author_name',
                'author_account.username as author_username',
                'author_account.url as author_url',
                'author_account.avatar_url as author_avatar_url',
                // Reposter fields
                'reposter_account.id as reposter_id',
                'reposter_account.name as reposter_name',
                'reposter_account.username as reposter_username',
                'reposter_account.url as reposter_url',
                'reposter_account.avatar_url as reposter_avatar_url',
                // Feed fields
                'feeds.id as feed_id',
            )
            .innerJoin('posts', 'posts.id', 'feeds.post_id')
            .innerJoin(
                'accounts as author_account',
                'author_account.id',
                'posts.author_id',
            )
            .leftJoin(
                'accounts as reposter_account',
                'reposter_account.id',
                'feeds.reposted_by_id',
            )
            .leftJoin('likes', function () {
                this.on('likes.post_id', 'posts.id').andOnVal(
                    'likes.account_id',
                    '=',
                    options.accountId.toString(),
                );
            })
            .leftJoin('reposts', function () {
                this.on('reposts.post_id', 'posts.id').andOnVal(
                    'reposts.account_id',
                    '=',
                    options.accountId.toString(),
                );
            })
            .whereRaw('feeds.user_id = ?', [userId])
            .where('feeds.post_type', postType)
            .modify((query) => {
                if (options.cursor) {
                    query.where('feeds.id', '<', options.cursor);
                }
            })
            .orderBy('feeds.id', 'desc')
            .limit(options.limit + 1);

        const results = await query;

        const hasMore = results.length > options.limit;
        const paginatedResults = results.slice(0, options.limit);
        const lastResult = paginatedResults[paginatedResults.length - 1];

        return {
            results: paginatedResults,
            nextCursor: hasMore ? lastResult.feed_id.toString() : null,
        };
    }

    /**
     * Add a post to the feeds of the users that should see it
     *
     * @param post Post to add to feeds
     * @param repostedBy ID of the account that reposted the post
     * @returns IDs of the users that had their feed updated
     */
    async addPostToFeeds(
        post: PublicPost | FollowersOnlyPost,
        repostedBy: number | null = null,
    ) {
        // Work out which user's feeds the post should be added to
        const targetUserIds = new Set<number>();
        let followersAccountId: number;

        // If the post is a reply, we should not add it to any feeds
        if (post.inReplyTo) {
            return [];
        }

        if (repostedBy) {
            // If the post is a repost, we should add the it to:
            // - The feed of the user associated with the account that reposted the post
            // - The feeds of the users who's accounts are followers of the account that reposted the post
            const repostedByInternalId = await this.db('users')
                .where('account_id', repostedBy)
                .select('id')
                .first();

            if (repostedByInternalId) {
                targetUserIds.add(repostedByInternalId.id);
            }

            followersAccountId = repostedBy;
        } else {
            // Otherwise, we should add the post to:
            // - The feed of the user associated with the author
            // - The feeds of the users who's accounts are followers of the account that authored the post
            // - The feed of any users that are being replied to in the post
            const authorInternalId = await this.db('users')
                .where('account_id', post.author.id)
                .select('id')
                .first();

            if (authorInternalId) {
                targetUserIds.add(authorInternalId.id);
            }

            followersAccountId = Number(post.author.id);
        }

        const followerIds = await this.db('follows')
            .join('users', 'follows.follower_id', 'users.account_id')
            .where('following_id', followersAccountId)
            .select('users.id as user_id');

        for (const follower of followerIds) {
            targetUserIds.add(follower.user_id);
        }

        // Add the post to the feeds
        const userIds = Array.from(targetUserIds).map(Number);

        if (userIds.length === 0) {
            return [];
        }

        const feedEntries = userIds.map((userId) => ({
            post_type: post.type,
            audience: post.audience,
            user_id: userId,
            post_id: post.id,
            author_id: post.author.id,
            reposted_by_id: repostedBy,
        }));

        const feedEntriesChunks = chunk(feedEntries, 1000);

        const transaction = await this.db.transaction();

        try {
            for (const feedEntries of feedEntriesChunks) {
                await transaction('feeds')
                    .insert(feedEntries)
                    .onConflict()
                    .ignore();
            }

            await transaction.commit();
        } catch (err) {
            await transaction.rollback();

            throw err;
        }

        return userIds;
    }

    /**
     * Remove a post from the feeds of the users that can already see it
     *
     * @param post Post to remove from feeds
     * @returns IDs of the users that had their feed updated
     */
    async removePostFromFeeds(post: Post) {
        // Work out which user's feeds the post should be removed from
        const updatedFeedUserIds = (
            await this.db('feeds').where('post_id', post.id).select('user_id')
        ).map((user) => user.user_id);

        // Remove the post from the feeds
        await this.db('feeds').where('post_id', post.id).delete();

        return updatedFeedUserIds;
    }
}
