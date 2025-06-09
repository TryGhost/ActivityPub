import type { Logger } from '@logtape/logtape';
import { getError, isError } from 'core/result';
import type { KnexPostRepository } from './post.repository.knex';
import type { PostService } from './post.service';

export class PostInteractionCountsService {
    constructor(
        private readonly postService: PostService,
        private readonly postRepository: KnexPostRepository,
        private logger: Logger,
    ) {}

    /**
     * Updates the interaction counts for the given post IDs, if the update is due.
     *
     * @param {number[]} postIds - The IDs of the posts to update
     */
    async updateInteractionCounts(postIds: number[]) {
        for (const postId of postIds) {
            const post = await this.postRepository.getById(postId);

            if (!post) {
                this.logger.error(
                    'Post with ID {postId} not found when updating interaction counts - Skipping',
                    { postId },
                );
                continue;
            }

            if (!this.isUpdateDue(post.publishedAt, post.updatedAt)) {
                this.logger.info(
                    'Post with ID {postId} is not due for an update of interaction counts - Skipping',
                    { postId },
                );
                continue;
            }

            const result = await this.postService.updateInteractionCounts(post);

            if (isError(result)) {
                this.logger.error(
                    'Error updating interaction counts for post with ID {postId}: {error}',
                    { postId, error: getError(result) },
                );
                continue;
            }

            this.logger.info(
                'Successfully updated interaction counts for post with ID {postId}',
                { postId },
            );
        }
    }

    /**
     * Computes whether the post is due an update of like/repost counts.
     *
     * @table
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

        const timeSinceLastUpdate = new Date().getTime() - lastUpdate.getTime();
        const timeSincePublished = new Date().getTime() - publishedAt.getTime();

        const sixHours = 6 * 60 * 60 * 1000;
        const tenMinutes = 10 * 60 * 1000;
        if (timeSincePublished < sixHours) {
            return timeSinceLastUpdate > tenMinutes;
        }

        const oneDay = 24 * 60 * 60 * 1000;
        const twoHours = 2 * 60 * 60 * 1000;
        if (timeSincePublished < oneDay) {
            return timeSinceLastUpdate > twoHours;
        }

        const oneWeek = 7 * 24 * 60 * 60 * 1000;
        if (timeSincePublished < oneWeek) {
            return timeSinceLastUpdate > sixHours;
        }

        return timeSinceLastUpdate > oneDay;
    }
}
