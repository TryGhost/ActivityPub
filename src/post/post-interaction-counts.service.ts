import type { Logger } from '@logtape/logtape';

import { getError, isError } from '@/core/result';
import type { PubSubEvents } from '@/events/pubsub';
import { PostInteractionCountsUpdateRequestedEvent } from '@/post/post-interaction-counts-update-requested.event';
import type { KnexPostRepository } from '@/post/post.repository.knex';
import {
    INTERACTION_COUNTS_NOT_FOUND,
    type PostService,
} from '@/post/post.service';

export class PostInteractionCountsService {
    constructor(
        private readonly postService: PostService,
        private readonly postRepository: KnexPostRepository,
        private readonly logging: Logger,
        private readonly commandBus: PubSubEvents,
    ) {}

    /**
     * Setup required event listeners for the service
     */
    init() {
        this.commandBus.on(
            PostInteractionCountsUpdateRequestedEvent.getName(),
            async (event: PostInteractionCountsUpdateRequestedEvent) =>
                await this.update(event.getPostIds()),
        );
    }

    /**
     * Request an update of the interaction counts for the given post IDs
     *
     * @param {string} host - The host of the site requesting the update
     * @param {number[]} postIds - The IDs of the posts to update
     */
    async requestUpdate(host: string, postIds: number[]) {
        await this.commandBus.emitAsync(
            PostInteractionCountsUpdateRequestedEvent.getName(),
            new PostInteractionCountsUpdateRequestedEvent(postIds),
            host,
        );
    }

    /**
     * Updates the interaction counts for the given post IDs, if the update is due.
     *
     * @param {number[]} postIds - The IDs of the posts to update
     */
    async update(postIds: number[]) {
        for (const postId of postIds) {
            const post = await this.postRepository.getById(postId);

            if (!post) {
                this.logging.error(
                    'Post with ID {postId} not found when updating interaction counts - Skipping',
                    { postId },
                );
                continue;
            }

            const postApId = post.apId;
            if (!this.isUpdateDue(post.publishedAt, post.updatedAt)) {
                this.logging.info(
                    'Post with ID {postId} is not due for an update of interaction counts - Skipping',
                    { postId, postApId },
                );
                continue;
            }

            const result = await this.postService.updateInteractionCounts(post);

            if (isError(result)) {
                const error = getError(result);

                if (error === INTERACTION_COUNTS_NOT_FOUND) {
                    this.logging.info(
                        'Post with ID {postId} does not expose interaction counts - Skipping',
                        { postId, postApId },
                    );
                } else {
                    this.logging.error(
                        'Error updating interaction counts for post with ID {postId}: {error}',
                        { postId, postApId, error },
                    );
                }

                continue;
            }

            this.logging.info(
                'Successfully updated interaction counts for post with ID {postId}',
                { postId, postApId },
            );
        }
    }

    /**
     * Computes whether the post is due an update of like/repost counts,
     * based on the following rules:
     *
     * | Post published       | Refresh interaction counts       |
     * |----------------------|----------------------------------|
     * | < 6 hours ago        | At most once every 10 minutes    |
     * | 6–24 hours ago       | At most once every 2 hours       |
     * | 1-7 days ago         | At most once every 6 hours       |
     * | > 7 days ago         | At most once per day             |
     *
     * @param {Date} publishedAt - The date and time the post was published
     * @param {Date|null} updatedAt - The date and time the post was last updated
     * @returns {boolean}
     */
    private isUpdateDue(publishedAt: Date, updatedAt: Date | null): boolean {
        let lastUpdate = updatedAt;
        if (lastUpdate === null) {
            lastUpdate = publishedAt;
        }

        const now = new Date().getTime();
        const timeSinceLastUpdate = now - lastUpdate.getTime();
        const timeSincePublished = now - publishedAt.getTime();

        const MINUTE = 60 * 1000;
        const HOUR = 60 * MINUTE;
        const DAY = 24 * HOUR;
        const WEEK = 7 * DAY;

        const TEN_MINUTES = 10 * MINUTE;
        const TWO_HOURS = 2 * HOUR;
        const SIX_HOURS = 6 * HOUR;

        if (timeSincePublished < SIX_HOURS) {
            return timeSinceLastUpdate > TEN_MINUTES;
        }

        if (timeSincePublished < DAY) {
            return timeSinceLastUpdate > TWO_HOURS;
        }

        if (timeSincePublished < WEEK) {
            return timeSinceLastUpdate > SIX_HOURS;
        }

        return timeSinceLastUpdate > DAY;
    }
}
