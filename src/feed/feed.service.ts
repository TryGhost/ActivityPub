import type { KvStore } from '@fedify/fedify';
import { chunk } from 'es-toolkit';
import type { Knex } from 'knex';
import type { FedifyRequestContext } from '../app';
import {
    ACTIVITY_OBJECT_TYPE_ARTICLE,
    ACTIVITY_OBJECT_TYPE_NOTE,
    ACTIVITY_TYPE_ANNOUNCE,
    ACTIVITY_TYPE_CREATE,
} from '../constants';
import { getActivityMetaWithoutJoin } from '../db';

import { type Activity, buildActivity } from 'helpers/activitypub/activity';
import { spanWrapper } from 'instrumentation';
import {
    type FollowersOnlyPost,
    PostType,
    type PublicPost,
} from 'post/post.entity';

export interface GetFeedOptions {
    postType: PostType | null;
    limit: number;
    cursor: string | null;
}

export interface GetFeedResult {
    items: Activity[];
    nextCursor: string | null;
}

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
     * Get a user's feed using the KV store
     *
     * The feed should contain posts that:
     * - Have been authored by the user (i.e Create(Article), Create(Note) in the user's outbox)
     * - Have been reposted by the user (i.e Announce(Article), Announce(Note) in the user's outbox)
     * - Have been authored by an account that the user follows (i.e Create(Article), Create(Note) in the user's inbox)
     * - Have been reposted by an account that the user follows (i.e Announce(Article), Announce(Note) in the user's inbox)
     * - Are not replies to other posts (i.e Create(Note).inReplyTo)
     *
     * The feed should be ordered reverse chronologically
     *
     * This method can be deprecated once we are reading data from the dedicated `posts` table
     *
     * @param db User scoped KV store
     * @param fedifyCtx Fedify request context
     * @param options Options for the query
     */
    async getFeedFromKvStore(
        db: KvStore,
        fedifyCtx: FedifyRequestContext,
        options: GetFeedOptions,
    ): Promise<GetFeedResult> {
        // Used to look up if a post is liked by the user
        const likedRefs = (await db.get<string[]>(['liked'])) || [];

        // Used to look up if a post is reposted by the user
        const repostedRefs = (await db.get<string[]>(['reposted'])) || [];

        // Used to look up posts from followers
        const inboxRefs = (await db.get<string[]>(['inbox'])) || [];

        // Used to look up the users own posts
        const outboxRefs = (await db.get<string[]>(['outbox'])) || [];

        let activityRefs = [...inboxRefs, ...outboxRefs];

        const activityMeta = await getActivityMetaWithoutJoin(activityRefs);
        activityRefs = activityRefs.filter((ref) => {
            const meta = activityMeta.get(ref);

            // If we can't find the meta data in the database for an activity,
            // we skip it as this is unexpected
            if (!meta) {
                return false;
            }

            // The feed should only contain Create and Announce activities
            if (
                meta.activity_type !== ACTIVITY_TYPE_CREATE &&
                meta.activity_type !== ACTIVITY_TYPE_ANNOUNCE
            ) {
                return false;
            }

            // The feed should not contain replies
            if (meta.reply_object_url !== null) {
                return false;
            }

            // Filter by the provided post type
            if (options.postType === null) {
                return [
                    ACTIVITY_OBJECT_TYPE_ARTICLE,
                    ACTIVITY_OBJECT_TYPE_NOTE,
                ].includes(meta!.object_type);
            }

            if (options.postType === PostType.Article) {
                return meta!.object_type === ACTIVITY_OBJECT_TYPE_ARTICLE;
            }

            if (options.postType === PostType.Note) {
                return meta!.object_type === ACTIVITY_OBJECT_TYPE_NOTE;
            }
        });

        // Sort the activity refs by the latest first (yes using the ID which
        // is totally gross but we have no other option at the moment)
        activityRefs.sort((a, b) => {
            return activityMeta.get(b)!.id - activityMeta.get(a)!.id;
        });

        // Paginate the activity refs
        const startIndex = options.cursor
            ? activityRefs.findIndex((ref) => ref === options.cursor) + 1
            : 0;

        const paginatedRefs = activityRefs.slice(
            startIndex,
            startIndex + options.limit,
        );

        const nextCursor =
            startIndex + paginatedRefs.length < activityRefs.length
                ? encodeURIComponent(paginatedRefs[paginatedRefs.length - 1])
                : null;

        // Build the activities
        const activities = await Promise.all(
            paginatedRefs.map(async (ref) => {
                try {
                    return await spanWrapper(buildActivity)(
                        ref,
                        fedifyCtx.data.globaldb,
                        fedifyCtx,
                        likedRefs,
                        repostedRefs,
                        true,
                    );
                } catch (err) {
                    fedifyCtx.data.logger.error(
                        'Error building activity ({ref}): {error}',
                        {
                            ref,
                            error: err,
                        },
                    );

                    return null;
                }
            }),
        );

        return {
            items: activities.filter((activity) => activity !== null),
            nextCursor,
        };
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
                // TODO: attachments
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
}
