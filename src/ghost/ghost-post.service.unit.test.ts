import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Logger } from '@logtape/logtape';
import type { Knex } from 'knex';

import type { Account } from '@/account/account.entity';
import type { AsyncEvents } from '@/core/events';
import { error, getError, getValue, isError, ok } from '@/core/result';
import { GhostPostService } from '@/ghost/ghost-post.service';
import { Post } from '@/post/post.entity';
import type { KnexPostRepository } from '@/post/post.repository.knex';
import type { PostService } from '@/post/post.service';

describe('GhostPostService', () => {
    let ghostPostService: GhostPostService;
    let mockDb: Knex;
    let mockPostService: PostService;
    let mockPostRepository: KnexPostRepository;
    let mockLogger: Logger;
    let mockEvents: AsyncEvents;
    let mockAccount: Account;
    let mockPost: Post;
    let mockQueryBuilder: {
        insert: ReturnType<typeof vi.fn>;
        select: ReturnType<typeof vi.fn>;
        where: ReturnType<typeof vi.fn>;
        first: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        mockLogger = {
            error: vi.fn(),
            info: vi.fn(),
        } as unknown as Logger;

        mockEvents = {} as unknown as AsyncEvents;

        mockAccount = {
            uuid: 'account-uuid-123',
        } as unknown as Account;

        mockPost = {
            id: 1,
            apId: new URL('https://example.com/posts/test-post'),
            uuid: 'post-uuid-456',
            title: 'Existing Post',
            content: '<p>Updated content</p>',
            excerpt: 'Updated excerpt',
            summary: null,
            imageUrl: null,
            url: new URL('https://example.com/existing'),
            metadata: null,
        } as unknown as Post;

        mockPostRepository = {
            save: vi.fn().mockResolvedValue(undefined),
        } as unknown as KnexPostRepository;

        mockPostService = {
            deleteByApId: vi.fn().mockResolvedValue(ok(true)),
            updateByApId: vi.fn().mockResolvedValue(ok(mockPost)),
        } as unknown as PostService;

        vi.spyOn(Post, 'createArticleFromGhostPost').mockResolvedValue(
            ok(mockPost),
        );

        mockQueryBuilder = {
            insert: vi.fn(),
            select: vi.fn(),
            where: vi.fn(),
            first: vi.fn(),
        };

        mockQueryBuilder.select.mockReturnValue(mockQueryBuilder);
        mockQueryBuilder.where.mockReturnValue(mockQueryBuilder);

        mockDb = vi.fn().mockReturnValue(mockQueryBuilder) as unknown as Knex;

        ghostPostService = new GhostPostService(
            mockDb,
            mockPostService,
            mockPostRepository,
            mockLogger,
            mockEvents,
        );
    });

    describe('createGhostPost', () => {
        it('should handle database insert failure with error and cleanup', async () => {
            mockQueryBuilder.first.mockResolvedValue(null); // No existing post by default
            const ghostPostData = {
                title: 'Test Ghost Post',
                uuid: 'test-uuid-123',
                html: '<p>Test content</p>',
                excerpt: 'Test excerpt',
                custom_excerpt: null,
                feature_image: null,
                published_at: new Date().toISOString(),
                url: 'https://example.com/test-post',
                visibility: 'public' as const,
                authors: [],
            };

            const insertError = new Error('Database connection failed');
            mockQueryBuilder.insert.mockRejectedValue(insertError);

            const result = await ghostPostService.createGhostPost(
                mockAccount,
                ghostPostData,
            );

            expect(isError(result)).toBe(true);
            if (!isError(result)) {
                throw new Error('Expected error result');
            }
            expect(getError(result)).toBe('failed-to-create-post');

            expect(Post.createArticleFromGhostPost).toHaveBeenCalledWith(
                mockAccount,
                ghostPostData,
            );

            expect(mockPostRepository.save).toHaveBeenCalledWith(mockPost);

            expect(mockDb).toHaveBeenCalledWith('ghost_ap_post_mappings');
            expect(mockQueryBuilder.insert).toHaveBeenCalledWith({
                ghost_uuid: ghostPostData.uuid,
                ap_id: mockPost.apId.href,
            });

            expect(mockLogger.error).toHaveBeenCalledWith(
                'Failed to create ghost post mapping for apId: {apId}, error: {error}',
                {
                    apId: mockPost.apId.href,
                    error: insertError,
                },
            );

            expect(mockPostService.deleteByApId).toHaveBeenCalledWith(
                mockPost.apId,
                mockAccount,
            );
        });

        it('should succeed when mapping insert works correctly', async () => {
            const ghostPostData = {
                title: 'Test Ghost Post Success',
                uuid: 'test-uuid-success-456',
                html: '<p>Success content</p>',
                excerpt: 'Success excerpt',
                custom_excerpt: null,
                feature_image: null,
                published_at: new Date().toISOString(),
                url: 'https://example.com/success-post',
                visibility: 'public' as const,
                authors: [],
            };

            mockQueryBuilder.insert.mockResolvedValue([1]);
            const result = await ghostPostService.createGhostPost(
                mockAccount,
                ghostPostData,
            );

            expect(isError(result)).toBe(false);
            if (isError(result)) {
                throw new Error('Expected success result');
            }
            expect(getValue(result)).toBe(mockPost);
            expect(mockQueryBuilder.insert).toHaveBeenCalledWith({
                ghost_uuid: ghostPostData.uuid,
                ap_id: mockPost.apId.href,
            });

            expect(mockLogger.error).not.toHaveBeenCalled();

            expect(mockPostService.deleteByApId).not.toHaveBeenCalled();
        });
    });

    describe('updateArticleFromGhostPost', () => {
        it('should return early if the post does not exist', async () => {
            mockQueryBuilder.first.mockResolvedValue(null); // No mapping found

            const ghostPostData = {
                title: 'Non-existent Post',
                uuid: 'non-existent-uuid',
                html: '<p>Content</p>',
                excerpt: 'Excerpt',
                custom_excerpt: null,
                feature_image: null,
                published_at: new Date().toISOString(),
                url: 'https://example.com/non-existent',
                visibility: 'public' as const,
                authors: [],
            };

            const result = await ghostPostService.updateArticleFromGhostPost(
                mockAccount,
                ghostPostData,
            );

            expect(mockLogger.info).toHaveBeenCalledWith(
                'Could not update post: Ghost post with UUID {uuid} was not found.',
                { uuid: ghostPostData.uuid },
            );
            expect(mockPostService.updateByApId).not.toHaveBeenCalled();
            expect(result).toBeUndefined();
        });

        it('should update the post when ghost post mapping exists', async () => {
            const apIdHref = 'https://example.com/posts/existing-post';
            mockQueryBuilder.first.mockResolvedValue({ ap_id: apIdHref }); // Mapping found

            const ghostPostData = {
                title: 'Existing Post',
                uuid: 'existing-uuid',
                html: '<p>Updated content</p>',
                excerpt: 'Updated excerpt',
                custom_excerpt: null,
                feature_image: null,
                published_at: new Date().toISOString(),
                url: 'https://example.com/existing',
                visibility: 'public' as const,
                authors: [],
            };

            const result = await ghostPostService.updateArticleFromGhostPost(
                mockAccount,
                ghostPostData,
            );

            expect(result).toBeUndefined();

            expect(mockPostService.updateByApId).toHaveBeenCalledWith(
                new URL(apIdHref),
                mockAccount,
                expect.objectContaining({
                    title: ghostPostData.title,
                    content: expect.any(String),
                }),
            );
        });
    });

    describe('deleteGhostPost', () => {
        it('should return post-not-found error when ghost post mapping does not exist', async () => {
            mockQueryBuilder.first.mockResolvedValue(null); // No mapping found

            const uuid = 'non-existent-uuid';

            const result = await ghostPostService.deleteGhostPost(
                mockAccount,
                uuid,
            );
            expect(isError(result)).toBe(true);
            if (!isError(result)) {
                throw new Error('Expected error result');
            }
            expect(getError(result)).toBe('post-not-found');
            expect(mockPostService.deleteByApId).not.toHaveBeenCalled();
        });

        it('should delete post when ghost post mapping exists', async () => {
            const apIdHref = 'https://example.com/posts/to-delete';
            mockQueryBuilder.first.mockResolvedValue({ ap_id: apIdHref }); // Mapping found

            const uuid = 'existing-uuid-to-delete';

            await ghostPostService.deleteGhostPost(mockAccount, uuid);
            expect(mockPostService.deleteByApId).toHaveBeenCalledWith(
                new URL(apIdHref),
                mockAccount,
            );
        });

        it('should return an error when deletion fails', async () => {
            const uuid = 'ee218320-b2e6-11ef-8a80-0242ac120010';
            const apIdHref = 'https://example.com/posts/to-delete';
            mockQueryBuilder.first.mockResolvedValue({ ap_id: apIdHref });
            mockPostService.deleteByApId = vi
                .fn()
                .mockResolvedValue(error('not-author'));

            const deleteResult = await ghostPostService.deleteGhostPost(
                mockAccount,
                uuid,
            );

            expect(mockPostService.deleteByApId).toHaveBeenCalledWith(
                new URL(apIdHref),
                mockAccount,
            );
            expect(isError(deleteResult)).toBe(true);
        });
    });
});
