import type { EventEmitter } from 'node:events';
import { chunk } from 'es-toolkit';
import type { Knex } from 'knex';
import { PostCreatedEvent } from '../post/post-created.event';
import { PostRepostedEvent } from '../post/post-reposted.event';
import {
    type FollowersOnlyPost,
    type PostType,
    type PublicPost,
    isFollowersOnlyPost,
    isPublicPost,
} from '../post/post.entity';
import {
    FeedsUpdatedEvent,
    FeedsUpdatedEventUpdateOperation,
} from './feeds-updated.event';

export interface GetFeedDataOptions {
    userId: number;
    postType: PostType;
    limit: number;
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

interface GetFeedDataResultRowNotReposted extends BaseGetFeedDataResultRow {
    reposter_id: null;
    reposter_name: null;
    reposter_username: null;
    reposter_url: null;
    reposter_avatar_url: null;
}

export type GetFeedDataResultRow =
    | GetFeedDataResultRowReposted
    | GetFeedDataResultRowNotReposted;

export interface GetFeedDataResult {
    results: GetFeedDataResultRow[];
    nextCursor: string | null;
}

export class FeedService {
    /**
     * @param db Database client
     * @param events Application event emitter
     */
    constructor(
        private readonly db: Knex,
        private readonly events: EventEmitter,
    ) {
        this.events.on(
            PostCreatedEvent.getName(),
            this.handlePostCreatedEvent.bind(this),
        );
        this.events.on(
            PostRepostedEvent.getName(),
            this.handlePostRepostedEvent.bind(this),
        );
    }

    /**
     * Get a user's feed data
     *
     * @param options Options for the query
     */
    async getFeedData(options: GetFeedDataOptions): Promise<GetFeedDataResult> {
        const query = this.db('feeds')
            .select(
                // Post fields
                this.db.raw('posts.id as post_id'),
                this.db.raw('posts.type as post_type'),
                this.db.raw('posts.title as post_title'),
                this.db.raw('posts.excerpt as post_excerpt'),
                this.db.raw('posts.content as post_content'),
                this.db.raw('posts.url as post_url'),
                this.db.raw('posts.image_url as post_image_url'),
                this.db.raw('posts.published_at as post_published_at'),
                this.db.raw('posts.like_count as post_like_count'),
                this.db.raw(`
                    CASE
                        WHEN likes.account_id IS NOT NULL THEN 1
                        ELSE 0
                    END AS post_liked_by_user
                `),
                this.db.raw('posts.reply_count as post_reply_count'),
                this.db.raw(
                    'posts.reading_time_minutes as post_reading_time_minutes',
                ),
                // TODO: attachments
                this.db.raw('posts.repost_count as post_repost_count'),
                this.db.raw(`
                    CASE
                        WHEN reposts.account_id IS NOT NULL THEN 1
                        ELSE 0
                    END AS post_reposted_by_user
                `),
                this.db.raw('posts.ap_id as post_ap_id'),
                // Author fields
                this.db.raw('author_account.id as author_id'),
                this.db.raw('author_account.name as author_name'),
                this.db.raw('author_account.username as author_username'),
                this.db.raw('author_account.url as author_url'),
                this.db.raw('author_account.avatar_url as author_avatar_url'),
                // Reposter fields
                this.db.raw('reposter_account.id as reposter_id'),
                this.db.raw('reposter_account.name as reposter_name'),
                this.db.raw('reposter_account.username as reposter_username'),
                this.db.raw('reposter_account.url as reposter_url'),
                this.db.raw(
                    'reposter_account.avatar_url as reposter_avatar_url',
                ),
                // Feed fields
                this.db.raw('feeds.created_at as feed_inserted_at'),
            )
            .innerJoin('posts', 'posts.id', 'feeds.post_id')
            .innerJoin(
                this.db.raw('accounts as author_account'),
                'author_account.id',
                'posts.author_id',
            )
            .leftJoin(
                this.db.raw('accounts as reposter_account'),
                'reposter_account.id',
                'feeds.reposted_by_id',
            )
            .innerJoin('users', this.db.raw('users.id = ?', [options.userId]))
            .innerJoin(
                this.db.raw('accounts as user_account'),
                'users.account_id',
                'user_account.id',
            )
            .leftJoin('likes', function () {
                this.on('likes.account_id', 'user_account.id').andOn(
                    'likes.post_id',
                    'posts.id',
                );
            })
            .leftJoin('reposts', function () {
                this.on('reposts.account_id', 'user_account.id').andOn(
                    'reposts.post_id',
                    'posts.id',
                );
            })
            .where('feeds.user_id', options.userId)
            .where('feeds.post_type', options.postType)
            .modify((query) => {
                if (options.cursor) {
                    const [timestamp, id] = options.cursor.split('_');

                    query.where((builder) => {
                        builder
                            .where('feeds.created_at', '<', new Date(timestamp))
                            .orWhere((subBuilder) => {
                                subBuilder
                                    .where(
                                        'feeds.created_at',
                                        '=',
                                        new Date(timestamp),
                                    )
                                    .andWhere('feeds.post_id', '<', id);
                            });
                    });
                }
            })
            .orderBy([
                { column: 'feeds.created_at', order: 'desc' },
                { column: 'feeds.post_id', order: 'desc' },
            ])
            .limit(options.limit + 1);

        const results = await query;

        const hasMore = results.length > options.limit;
        const items = results.slice(0, options.limit);
        const lastItem = items[items.length - 1];

        return {
            results: items,
            nextCursor: hasMore
                ? `${lastItem.feed_inserted_at.toISOString()}_${lastItem.post_id}`
                : null,
        };
    }

    /**
     * Handle a post created event
     *
     * @param event Post created event
     */
    private async handlePostCreatedEvent(event: PostCreatedEvent) {
        const post = event.getPost();

        let updatedFeedUserIds: number[] = [];

        if (isPublicPost(post) || isFollowersOnlyPost(post)) {
            updatedFeedUserIds = await this.addPostToFeeds(post);
        }

        if (updatedFeedUserIds.length > 0) {
            this.events.emit(
                FeedsUpdatedEvent.getName(),
                new FeedsUpdatedEvent(
                    updatedFeedUserIds,
                    FeedsUpdatedEventUpdateOperation.PostAdded,
                    post,
                ),
            );
        }
    }

    /**
     * Handle a post reposted event
     *
     * @param event Post reposted event
     */
    private async handlePostRepostedEvent(event: PostRepostedEvent) {
        const post = event.getPost();
        const repostedBy = event.getAccountId();

        let updatedFeedUserIds: number[] = [];

        if (isPublicPost(post) || isFollowersOnlyPost(post)) {
            updatedFeedUserIds = await this.addPostToFeeds(post, repostedBy);
        }

        if (updatedFeedUserIds.length > 0) {
            this.events.emit(
                FeedsUpdatedEvent.getName(),
                new FeedsUpdatedEvent(
                    updatedFeedUserIds,
                    FeedsUpdatedEventUpdateOperation.PostAdded,
                    post,
                ),
            );
        }
    }

    /**
     * Add a post to the feeds of the users that should see it
     *
     * @param post Post to add to feeds
     * @param repostedBy ID of the account that reposted the post
     * @returns IDs of the users that had their feed updated
     */
    private async addPostToFeeds(
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
}
