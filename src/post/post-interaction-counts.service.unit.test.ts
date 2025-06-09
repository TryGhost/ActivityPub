import type { Logger } from '@logtape/logtape';
import { error, ok } from 'core/result';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PostInteractionCountsService } from './post-interaction-counts.service';
import type { Post } from './post.entity';
import type { KnexPostRepository } from './post.repository.knex';
import type { PostService } from './post.service';

describe('PostInteractionCountsService', () => {
    let service: PostInteractionCountsService;
    let mockPostService: PostService;
    let mockPostRepository: KnexPostRepository;
    let mockLogger: Logger;

    beforeEach(() => {
        mockPostService = {
            updateInteractionCounts: vi.fn(),
        } as unknown as PostService;
        mockPostRepository = {
            getById: vi.fn(),
        } as unknown as KnexPostRepository;
        mockLogger = {
            info: vi.fn(),
            error: vi.fn(),
        } as unknown as Logger;
        service = new PostInteractionCountsService(
            mockPostService,
            mockPostRepository,
            mockLogger,
        );
    });

    describe('updateInteractionCounts', () => {
        it('skips updating interaction counts if post is not found and logs an error', async () => {
            const postId = 999;
            vi.mocked(mockPostRepository.getById).mockResolvedValue(null);

            await service.updateInteractionCounts([postId]);

            expect(
                mockPostService.updateInteractionCounts,
            ).not.toHaveBeenCalled();
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Post with ID {postId} not found when updating interaction counts - Skipping',
                { postId },
            );
        });

        it('logs an error if updating interaction counts fails', async () => {
            const postId = 1;
            const publishedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
            const updatedAt = new Date(Date.now() - 15 * 60 * 1000);
            const post = {
                id: postId,
                publishedAt,
                updatedAt,
            } as Post;

            vi.mocked(mockPostRepository.getById).mockResolvedValue(post);
            vi.mocked(
                mockPostService.updateInteractionCounts,
            ).mockResolvedValue(error('upstream-error'));

            await service.updateInteractionCounts([postId]);

            expect(mockLogger.error).toHaveBeenCalledWith(
                'Error updating interaction counts for post with ID {postId}: {error}',
                { postId, error: 'upstream-error' },
            );
        });

        it('does not update a post published less than 6 hours ago more than once every 10 minutes', async () => {
            const postId = 1;
            const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
            const publishedAt = twoHoursAgo;

            // First call with updatedAt null - should update
            let post = {
                id: postId,
                publishedAt,
                updatedAt: null,
            } as Post;

            vi.mocked(mockPostRepository.getById).mockResolvedValue(post);
            vi.mocked(
                mockPostService.updateInteractionCounts,
            ).mockResolvedValue(ok(post));

            await service.updateInteractionCounts([postId]);

            expect(
                mockPostService.updateInteractionCounts,
            ).toHaveBeenCalledWith(post);
            expect(mockLogger.info).toHaveBeenCalledWith(
                'Successfully updated interaction counts for post with ID {postId}',
                { postId },
            );

            // Reset mocks for second call
            vi.clearAllMocks();

            // Second call with updatedAt 5 minutes ago - should skip
            const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
            post = {
                id: postId,
                publishedAt,
                updatedAt: fiveMinutesAgo,
            } as Post;

            vi.mocked(mockPostRepository.getById).mockResolvedValue(post);

            await service.updateInteractionCounts([postId]);

            expect(
                mockPostService.updateInteractionCounts,
            ).not.toHaveBeenCalled();
            expect(mockLogger.info).toHaveBeenCalledWith(
                'Post with ID {postId} is not due for an update of interaction counts - Skipping',
                { postId },
            );
        });

        it('does not update a post published between 6-24 hours ago more than once every 2 hours', async () => {
            const postId = 1;
            const publishedAt = new Date(Date.now() - 12 * 60 * 60 * 1000); // 12 hours ago

            // First call with updatedAt more than 2 hours ago - should update
            const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
            let post = {
                id: postId,
                publishedAt,
                updatedAt: threeHoursAgo,
            } as Post;

            vi.mocked(mockPostRepository.getById).mockResolvedValue(post);
            vi.mocked(
                mockPostService.updateInteractionCounts,
            ).mockResolvedValue(ok(post));

            await service.updateInteractionCounts([postId]);

            expect(
                mockPostService.updateInteractionCounts,
            ).toHaveBeenCalledWith(post);
            expect(mockLogger.info).toHaveBeenCalledWith(
                'Successfully updated interaction counts for post with ID {postId}',
                { postId },
            );

            // Reset mocks for second call
            vi.clearAllMocks();

            // Second call with updatedAt 1 hour ago - should skip
            const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000);
            post = {
                id: postId,
                publishedAt,
                updatedAt: oneHourAgo,
            } as Post;

            vi.mocked(mockPostRepository.getById).mockResolvedValue(post);

            await service.updateInteractionCounts([postId]);

            expect(
                mockPostService.updateInteractionCounts,
            ).not.toHaveBeenCalled();
            expect(mockLogger.info).toHaveBeenCalledWith(
                'Post with ID {postId} is not due for an update of interaction counts - Skipping',
                { postId },
            );
        });

        it('does not update a post published between 1-7 days ago more than once every 6 hours', async () => {
            const postId = 1;
            const publishedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000); // 3 days ago

            // First call with updatedAt more than 6 hours ago - should update
            const sevenHoursAgo = new Date(Date.now() - 7 * 60 * 60 * 1000);
            let post = {
                id: postId,
                publishedAt,
                updatedAt: sevenHoursAgo,
            } as Post;

            vi.mocked(mockPostRepository.getById).mockResolvedValue(post);
            vi.mocked(
                mockPostService.updateInteractionCounts,
            ).mockResolvedValue(ok(post));

            await service.updateInteractionCounts([postId]);

            expect(
                mockPostService.updateInteractionCounts,
            ).toHaveBeenCalledWith(post);
            expect(mockLogger.info).toHaveBeenCalledWith(
                'Successfully updated interaction counts for post with ID {postId}',
                { postId },
            );

            // Reset mocks for second call
            vi.clearAllMocks();

            // Second call with updatedAt 4 hours ago - should skip
            const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
            post = {
                id: postId,
                publishedAt,
                updatedAt: fourHoursAgo,
            } as Post;

            vi.mocked(mockPostRepository.getById).mockResolvedValue(post);

            await service.updateInteractionCounts([postId]);

            expect(
                mockPostService.updateInteractionCounts,
            ).not.toHaveBeenCalled();
            expect(mockLogger.info).toHaveBeenCalledWith(
                'Post with ID {postId} is not due for an update of interaction counts - Skipping',
                { postId },
            );
        });

        it('does not update a post published more than 7 days ago more than once a day', async () => {
            const postId = 1;
            const publishedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago

            // First call with updatedAt more than 24 hours ago - should update
            const twentyFiveHoursAgo = new Date(
                Date.now() - 25 * 60 * 60 * 1000,
            );
            let post = {
                id: postId,
                publishedAt,
                updatedAt: twentyFiveHoursAgo,
            } as Post;

            vi.mocked(mockPostRepository.getById).mockResolvedValue(post);
            vi.mocked(
                mockPostService.updateInteractionCounts,
            ).mockResolvedValue(ok(post));

            await service.updateInteractionCounts([postId]);

            expect(
                mockPostService.updateInteractionCounts,
            ).toHaveBeenCalledWith(post);
            expect(mockLogger.info).toHaveBeenCalledWith(
                'Successfully updated interaction counts for post with ID {postId}',
                { postId },
            );

            // Reset mocks for second call
            vi.clearAllMocks();

            // Second call with updatedAt 12 hours ago - should skip
            const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
            post = {
                id: postId,
                publishedAt,
                updatedAt: twelveHoursAgo,
            } as Post;

            vi.mocked(mockPostRepository.getById).mockResolvedValue(post);

            await service.updateInteractionCounts([postId]);

            expect(
                mockPostService.updateInteractionCounts,
            ).not.toHaveBeenCalled();
            expect(mockLogger.info).toHaveBeenCalledWith(
                'Post with ID {postId} is not due for an update of interaction counts - Skipping',
                { postId },
            );
        });
    });
});
