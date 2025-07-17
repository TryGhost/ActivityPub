import type { Logger } from '@logtape/logtape';
import type { Account } from 'account/account.entity';
import type { AsyncEvents } from 'core/events';
import { getError, getValue, isError, ok } from 'core/result';
import type { Knex } from 'knex';
import { Post } from 'post/post.entity';
import type { KnexPostRepository } from 'post/post.repository.knex';
import type { PostService } from 'post/post.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GhostPostService } from './ghost-post.service';

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
        } as unknown as Logger;

        mockEvents = {} as unknown as AsyncEvents;

        mockAccount = {
            uuid: 'account-uuid-123',
        } as unknown as Account;

        mockPost = {
            id: 1,
            apId: new URL('https://example.com/posts/test-post'),
            uuid: 'post-uuid-456',
        } as unknown as Post;

        mockPostRepository = {
            save: vi.fn().mockResolvedValue(undefined),
        } as unknown as KnexPostRepository;

        mockPostService = {
            deleteByApId: vi.fn().mockResolvedValue(ok(true)),
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
});
