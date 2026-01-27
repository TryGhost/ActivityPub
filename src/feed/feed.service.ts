import { chunk } from 'es-toolkit';
import type { Knex } from 'knex';

import { sanitizeHtml } from '@/helpers/html';
import type { ModerationService } from '@/moderation/moderation.service';
import {
    type FollowersOnlyPost,
    type Post,
    PostType,
    type PublicPost,
} from '@/post/post.entity';
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
    post_summary: string | null;
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
    author_followed_by_user: 0 | 1;
}

interface GetFeedDataResultRowReposted extends BaseGetFeedDataResultRow {
    reposter_id: number;
    reposter_name: string | null;
    reposter_username: string;
    reposter_url: string | null;
    reposter_avatar_url: string | null;
    reposter_followed_by_user: 0 | 1;
}

interface GetFeedDataResultRowWithoutReposted extends BaseGetFeedDataResultRow {
    reposter_id: null;
    reposter_name: null;
    reposter_username: null;
    reposter_url: null;
    reposter_avatar_url: null;
    reposter_followed_by_user: 0;
}

export type GetFeedDataResultRow =
    | GetFeedDataResultRowReposted
    | GetFeedDataResultRowWithoutReposted;

export interface GetFeedDataResult {
    results: GetFeedDataResultRow[];
    nextCursor: string | null;
}

export class FeedService {
    constructor(
        private readonly db: Knex,
        private readonly moderationService: ModerationService,
    ) {}

    /**
     * Get a topic by slug
     *
     * @param slug Topic slug
     * @returns Topic ID or null if not found
     */
    async getTopicBySlug(slug: string): Promise<{ id: number } | null> {
        const topic = await this.db('topics')
            .where('slug', slug)
            .select('id')
            .first();

        return topic ?? null;
    }

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

        const results = await this.db('feeds')
            .select(
                // Post fields
                'posts.id as post_id',
                'posts.type as post_type',
                'posts.title as post_title',
                'posts.excerpt as post_excerpt',
                'posts.summary as post_summary',
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
                this.db.raw(`
                    CASE
                        WHEN follows_author.following_id IS NOT NULL THEN 1
                        ELSE 0
                    END AS author_followed_by_user
                `),
                // Reposter fields
                'reposter_account.id as reposter_id',
                'reposter_account.name as reposter_name',
                'reposter_account.username as reposter_username',
                'reposter_account.url as reposter_url',
                'reposter_account.avatar_url as reposter_avatar_url',
                this.db.raw(`
                    CASE
                        WHEN follows_reposter.following_id IS NOT NULL THEN 1
                        ELSE 0
                    END AS reposter_followed_by_user
                `),
                // Feed fields
                'feeds.published_at as feed_published_at',
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
            .leftJoin('follows as follows_author', function () {
                this.on(
                    'follows_author.following_id',
                    'author_account.id',
                ).andOnVal(
                    'follows_author.follower_id',
                    '=',
                    options.accountId.toString(),
                );
            })
            .leftJoin('follows as follows_reposter', function () {
                this.on(
                    'follows_reposter.following_id',
                    'reposter_account.id',
                ).andOnVal(
                    'follows_reposter.follower_id',
                    '=',
                    options.accountId.toString(),
                );
            })
            .whereRaw('feeds.user_id = ?', [userId])
            .where('feeds.post_type', postType)
            .modify((query) => {
                if (options.cursor) {
                    query.where('feeds.published_at', '<', options.cursor);
                }
            })
            .orderBy('feeds.published_at', 'desc')
            .limit(options.limit + 1);

        const hasMore = results.length > options.limit;
        const paginatedResults = results.slice(0, options.limit);
        const lastResult = paginatedResults[paginatedResults.length - 1];

        return {
            results: paginatedResults.map((item: BaseGetFeedDataResultRow) => {
                return {
                    ...item,
                    post_content: sanitizeHtml(item.post_content ?? ''),
                };
            }),
            nextCursor: hasMore ? lastResult.feed_published_at : null,
        };
    }

    /**
     * Get data for a discovery feed by topic
     *
     * @param topicId ID of the topic
     * @param viewerAccountId ID of the account of the user viewing the discovery feed
     * @param limit Maximum number of posts to return
     * @param cursor Cursor to use for pagination
     */
    async getDiscoveryFeedData(
        topicId: number,
        viewerAccountId: number,
        limit: number,
        cursor: string | null,
    ): Promise<GetFeedDataResult> {
        const postType: PostType = PostType.Article;

        const results = await this.db('discovery_feeds')
            .select(
                // Post fields
                'posts.id as post_id',
                'posts.type as post_type',
                'posts.title as post_title',
                'posts.excerpt as post_excerpt',
                'posts.summary as post_summary',
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
                this.db.raw(`
                    CASE
                        WHEN follows_author.following_id IS NOT NULL THEN 1
                        ELSE 0
                    END AS author_followed_by_user
                `),
                'discovery_feeds.published_at as feed_published_at',
            )
            .innerJoin('posts', 'posts.id', 'discovery_feeds.post_id')
            .innerJoin(
                'accounts as author_account',
                'author_account.id',
                'posts.author_id',
            )
            .leftJoin('likes', function () {
                this.on('likes.post_id', 'posts.id').andOnVal(
                    'likes.account_id',
                    '=',
                    viewerAccountId.toString(),
                );
            })
            .leftJoin('reposts', function () {
                this.on('reposts.post_id', 'posts.id').andOnVal(
                    'reposts.account_id',
                    '=',
                    viewerAccountId.toString(),
                );
            })
            .leftJoin('follows as follows_author', function () {
                this.on(
                    'follows_author.following_id',
                    'author_account.id',
                ).andOnVal(
                    'follows_author.follower_id',
                    '=',
                    viewerAccountId.toString(),
                );
            })
            .leftJoin('blocks', function () {
                this.on(
                    'blocks.blocked_id',
                    'discovery_feeds.author_id',
                ).andOnVal(
                    'blocks.blocker_id',
                    '=',
                    viewerAccountId.toString(),
                );
            })
            .leftJoin('domain_blocks', function () {
                this.on(
                    'domain_blocks.domain_hash',
                    'author_account.domain_hash',
                ).andOnVal(
                    'domain_blocks.blocker_id',
                    '=',
                    viewerAccountId.toString(),
                );
            })
            .whereRaw('discovery_feeds.topic_id = ?', [topicId])
            .where('discovery_feeds.post_type', postType)
            .whereNull('blocks.id')
            .whereNull('domain_blocks.id')
            .modify((query) => {
                if (cursor) {
                    query.where('discovery_feeds.published_at', '<', cursor);
                }
            })
            .orderBy('discovery_feeds.published_at', 'desc')
            .limit(limit + 1);

        const hasMore = results.length > limit;
        const paginatedResults = results.slice(0, limit);
        const lastResult = paginatedResults[paginatedResults.length - 1];

        return {
            results: paginatedResults.map((item: BaseGetFeedDataResultRow) => {
                return {
                    ...item,
                    post_content: sanitizeHtml(item.post_content ?? ''),
                };
            }),
            nextCursor: hasMore ? lastResult.feed_published_at : null,
        };
    }

    /**
     * Add a post to discovery feeds based on the author's topics
     *
     * @param post Post to add to discovery feeds
     */
    async addPostToDiscoveryFeeds(post: PublicPost | FollowersOnlyPost) {
        // For now, discovery feed only render Articles
        if (post.type !== PostType.Article) {
            return [];
        }

        if (post.inReplyTo) {
            return [];
        }

        const topics = await this.db('account_topics')
            .where('account_id', post.author.id)
            .select('topic_id');

        if (topics.length === 0) {
            return [];
        }

        const discoveryFeedEntries = topics.map((t) => ({
            post_type: post.type,
            published_at: post.publishedAt,
            topic_id: t.topic_id,
            post_id: post.id,
            author_id: post.author.id,
        }));

        const discoveryFeedEntriesChunks = chunk(discoveryFeedEntries, 1000);

        const transaction = await this.db.transaction();

        try {
            for (const entries of discoveryFeedEntriesChunks) {
                await transaction('discovery_feeds')
                    .insert(entries)
                    .onConflict()
                    .ignore();
            }

            await transaction.commit();
        } catch (err) {
            await transaction.rollback();

            throw err;
        }
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

        let repost: { created_at: Date } | null = null;

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

            repost = await this.db('reposts')
                .where('account_id', repostedBy)
                .where('post_id', post.id)
                .select('created_at')
                .first();
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

        // Add post to the users feeds
        const userIds = await this.moderationService.filterUsersForPost(
            Array.from(targetUserIds).map(Number),
            post,
            repostedBy ?? undefined,
        );

        if (userIds.length === 0) {
            return [];
        }

        const feedEntries = userIds.map((userId) => ({
            post_type: post.type,
            published_at:
                repostedBy && repost ? repost.created_at : post.publishedAt,
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
     * @param postId ID of the post to remove from feeds
     * @param derepostedBy ID of the account that dereposted the post (if applicable)
     * @returns IDs of the users that had their feed updated
     */
    async removePostFromFeeds(
        postId: number,
        derepostedBy: number | null = null,
    ) {
        // Work out which user's feeds the post should be removed from
        const updatedFeedUserIds = (
            await this.db('feeds')
                .where('post_id', postId)
                .modify((queryBuilder) => {
                    if (derepostedBy) {
                        queryBuilder.where('reposted_by_id', derepostedBy);
                    }
                })
                .select('user_id')
        ).map((user: { user_id: number }) => user.user_id);

        // Remove the post from the feeds
        await this.db('feeds')
            .where('post_id', postId)
            .modify((queryBuilder) => {
                if (derepostedBy) {
                    queryBuilder.where('reposted_by_id', derepostedBy);
                }
            })
            .delete();

        return updatedFeedUserIds;
    }

    /**
     * Remove a post from discovery feeds
     *
     * @param post Post to remove from discovery feeds
     */
    async removePostFromDiscoveryFeeds(post: Post) {
        await this.db('discovery_feeds').where('post_id', post.id).delete();
    }

    async removeBlockedAccountPostsFromFeed(
        feedAccountId: number,
        blockedAccountId: number,
    ) {
        const user = await this.db('users')
            .where('account_id', feedAccountId)
            .select('id')
            .first();

        if (!user) {
            return;
        }

        await this.db('feeds')
            .where((qb) => {
                qb.where('author_id', blockedAccountId).orWhere(
                    'reposted_by_id',
                    blockedAccountId,
                );
            })
            .andWhere('user_id', user.id)
            .delete();
    }

    async removeBlockedDomainPostsFromFeed(
        feedAccountId: number,
        blockedDomain: URL,
    ) {
        const user = await this.db('users')
            .where('account_id', feedAccountId)
            .select('id')
            .first();

        if (!user) {
            return;
        }

        await this.db('feeds')
            .join('accounts', function () {
                this.on('feeds.author_id', 'accounts.id').orOn(
                    'feeds.reposted_by_id',
                    'accounts.id',
                );
            })
            .where('feeds.user_id', user.id)
            .andWhereRaw('accounts.domain_hash = UNHEX(SHA2(LOWER(?), 256))', [
                blockedDomain.host,
            ])
            .delete();
    }

    async removeUnfollowedAccountPostsFromFeed(
        feedAccountId: number,
        unfollowedAccountId: number,
    ) {
        const user = await this.db('users')
            .where('account_id', feedAccountId)
            .select('id')
            .first();

        if (!user) {
            return;
        }

        await this.db('feeds')
            .where((qb) => {
                qb.where('author_id', unfollowedAccountId).orWhere(
                    'reposted_by_id',
                    unfollowedAccountId,
                );
            })
            .andWhere('user_id', user.id)
            .delete();
    }
}
