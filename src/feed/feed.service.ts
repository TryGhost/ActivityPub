import type { EventEmitter } from 'node:events';
import type { KvStore } from '@fedify/fedify';
import type { AccountService } from 'account/account.service';
import type { Knex } from 'knex';
import type { Account } from '../account/types';
import type { FedifyRequestContext } from '../app';
import {
    ACTIVITY_OBJECT_TYPE_ARTICLE,
    ACTIVITY_OBJECT_TYPE_NOTE,
    ACTIVITY_TYPE_ANNOUNCE,
    ACTIVITY_TYPE_CREATE,
    TABLE_FEEDS,
    TABLE_FOLLOWS,
    TABLE_USERS,
} from '../constants';
import { getActivityMetaWithoutJoin } from '../db';
import { type Activity, buildActivity } from '../helpers/activitypub/activity';
import { spanWrapper } from '../instrumentation';
import { PostCreatedEvent } from '../post/post-created.event';
import {
    type FollowersOnlyPost,
    type PublicPost,
    isFollowersOnlyPost,
    isPublicPost,
} from '../post/post.entity';
import {
    FeedsUpdatedEvent,
    FeedsUpdatedEventUpdateOperation,
} from './feeds-updated.event';
import { PostType } from './types';

export interface GetFeedOptions {
    postType: PostType | null;
    limit: number;
    cursor: string | null;
}

export interface GetFeedResult {
    items: Activity[];
    nextCursor: string | null;
}

export class FeedService {
    /**
     * @param db Database client
     * @param events Application event emitter
     * @param accountService Account service
     */
    constructor(
        private readonly db: Knex,
        private readonly events: EventEmitter,
        private readonly accountService: AccountService,
    ) {
        this.events.on(
            PostCreatedEvent.getName(),
            async (event: PostCreatedEvent) => {
                await this.handlePostCreatedEvent(event);
            },
        );
    }

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

    private async handlePostCreatedEvent(event: PostCreatedEvent) {
        const post = event.getPost();

        if (isPublicPost(post) || isFollowersOnlyPost(post)) {
            this.addPostToFeeds(post);
        }
    }

    /**
     * Add a post to the feeds of the users that should see it
     *
     * If the post audience = Public then the post should be added to:
     * - The feed of the user that authored the post
     * - The feeds of all users that follow the author
     *
     * If the post audience = FollowersOnly then the post should be added to:
     * - The feed of the user that authored the post
     * - The feeds of all users that follow the author
     *
     * @param event Post created event
     */
    private async addPostToFeeds(post: PublicPost | FollowersOnlyPost) {
        // Work out which user's feeds the post should be added to
        const targetUserIds = new Set();

        const authorInternalId =
            await this.accountService.getInternalIdForAccount(
                post.author as unknown as AccountType,
            );

        if (authorInternalId) {
            targetUserIds.add(authorInternalId);
        }

        const followerIds = await this.db(TABLE_FOLLOWS)
            .join(TABLE_USERS, 'follows.follower_id', 'users.id')
            .where('following_id', post.author.id)
            .select('follows.follower_id');

        for (const follower of followerIds) {
            targetUserIds.add(follower.follower_id);
        }

        // Add the post to the feeds
        const userIds = Array.from(targetUserIds).map(Number);

        const feedEntries = userIds.map((userId) => ({
            post_type: post.type,
            audience: post.audience,
            user_id: userId,
            post_id: post.id,
            author_id: post.author.id,
            // @TODO: Handle reposted_by_id
        }));

        await this.db(TABLE_FEEDS).insert(feedEntries); // @TODO: Is there a limit on the number of rows we can insert at once?

        // Emit event to notify listeners that multiple feeds have been updated
        this.events.emit(
            FeedsUpdatedEvent.getName(),
            new FeedsUpdatedEvent(
                userIds,
                FeedsUpdatedEventUpdateOperation.PostAdded,
                post,
            ),
        );
    }
}
