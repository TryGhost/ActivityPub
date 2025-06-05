import { Collection, Note } from '@fedify/fedify';
import type { FedifyContextFactory } from 'activitypub/fedify-context.factory';
import { describe, expect, it, vi } from 'vitest';
import { PostInteractionCountsService } from './post-interaction-counts.service';
import type { KnexPostRepository } from './post.repository.knex';

describe('PostInteractionCountsService', () => {
    describe('refreshInteractionCounts', () => {
        it('updates the like/repost counts if they have changed', async () => {
            const postRepository = {
                getById: vi.fn().mockResolvedValue({
                    id: 1,
                    apId: 'https://example.com/posts/1',
                    likeCount: 3,
                    repostCount: 2,
                }),
                updateInteractionCounts: vi.fn(),
            };

            const note = new Note({
                id: new URL('https://example.com/posts/1'),
                url: new URL('https://example.com/posts/1'),
                content: 'Hello, world!',
                likes: new Collection({
                    totalItems: 5,
                }),
                shares: new Collection({
                    totalItems: 10,
                }),
            });

            const fedifyContextFactory = {
                getFedifyContext: vi.fn().mockReturnValue({
                    getDocumentLoader: vi.fn().mockResolvedValue({}),
                    lookupObject: vi.fn().mockResolvedValue(note),
                }),
            };

            const postInteractionCountsService =
                new PostInteractionCountsService(
                    postRepository as unknown as KnexPostRepository,
                    fedifyContextFactory as unknown as FedifyContextFactory,
                );

            await postInteractionCountsService.refreshInteractionCounts(1);

            expect(postRepository.updateInteractionCounts).toHaveBeenCalledWith(
                1,
                5,
                10,
            );
        });

        it('does not update the like/repost counts if they have not changed', async () => {
            const postRepository = {
                getById: vi.fn().mockResolvedValue({
                    id: 1,
                    apId: 'https://example.com/posts/1',
                    likeCount: 3,
                    repostCount: 2,
                }),
                updateInteractionCounts: vi.fn(),
            };

            const note = new Note({
                id: new URL('https://example.com/posts/1'),
                url: new URL('https://example.com/posts/1'),
                content: 'Hello, world!',
                likes: new Collection({
                    totalItems: 3,
                }),
                shares: new Collection({
                    totalItems: 2,
                }),
            });

            const fedifyContextFactory = {
                getFedifyContext: vi.fn().mockReturnValue({
                    getDocumentLoader: vi.fn().mockResolvedValue({}),
                    lookupObject: vi.fn().mockResolvedValue(note),
                }),
            };

            const postInteractionCountsService =
                new PostInteractionCountsService(
                    postRepository as unknown as KnexPostRepository,
                    fedifyContextFactory as unknown as FedifyContextFactory,
                );

            await postInteractionCountsService.refreshInteractionCounts(1);

            expect(
                postRepository.updateInteractionCounts,
            ).not.toHaveBeenCalled();
        });

        it('can update the like count but not the repost count', async () => {
            const postRepository = {
                getById: vi.fn().mockResolvedValue({
                    id: 1,
                    apId: 'https://example.com/posts/1',
                    likeCount: 3,
                    repostCount: 2,
                }),
                updateInteractionCounts: vi.fn(),
            };

            const note = new Note({
                id: new URL('https://example.com/posts/1'),
                url: new URL('https://example.com/posts/1'),
                content: 'Hello, world!',
                likes: new Collection({
                    totalItems: 5,
                }),
                shares: new Collection({
                    totalItems: 2,
                }),
            });

            const fedifyContextFactory = {
                getFedifyContext: vi.fn().mockReturnValue({
                    getDocumentLoader: vi.fn().mockResolvedValue({}),
                    lookupObject: vi.fn().mockResolvedValue(note),
                }),
            };

            const postInteractionCountsService =
                new PostInteractionCountsService(
                    postRepository as unknown as KnexPostRepository,
                    fedifyContextFactory as unknown as FedifyContextFactory,
                );

            await postInteractionCountsService.refreshInteractionCounts(1);

            expect(postRepository.updateInteractionCounts).toHaveBeenCalledWith(
                1,
                5,
                undefined,
            );
        });

        it('can update the repost count but not the like count', async () => {
            const postRepository = {
                getById: vi.fn().mockResolvedValue({
                    id: 1,
                    apId: 'https://example.com/posts/1',
                    likeCount: 3,
                    repostCount: 2,
                }),
                updateInteractionCounts: vi.fn(),
            };

            const note = new Note({
                id: new URL('https://example.com/posts/1'),
                url: new URL('https://example.com/posts/1'),
                content: 'Hello, world!',
                likes: new Collection({
                    totalItems: 3,
                }),
                shares: new Collection({
                    totalItems: 5,
                }),
            });

            const fedifyContextFactory = {
                getFedifyContext: vi.fn().mockReturnValue({
                    getDocumentLoader: vi.fn().mockResolvedValue({}),
                    lookupObject: vi.fn().mockResolvedValue(note),
                }),
            };

            const postInteractionCountsService =
                new PostInteractionCountsService(
                    postRepository as unknown as KnexPostRepository,
                    fedifyContextFactory as unknown as FedifyContextFactory,
                );

            await postInteractionCountsService.refreshInteractionCounts(1);

            expect(postRepository.updateInteractionCounts).toHaveBeenCalledWith(
                1,
                undefined,
                5,
            );
        });

        it('does not throw an error if the remote object is not a Note or Article', async () => {
            const postRepository = {
                getById: vi.fn().mockResolvedValue({
                    id: 1,
                    apId: 'https://example.com/posts/1',
                    likeCount: 3,
                    repostCount: 2,
                }),
                updateInteractionCounts: vi.fn(),
            };

            const fedifyContextFactory = {
                getFedifyContext: vi.fn().mockReturnValue({
                    getDocumentLoader: vi.fn().mockResolvedValue({}),
                    lookupObject: vi.fn().mockResolvedValue(null),
                }),
            };

            const postInteractionCountsService =
                new PostInteractionCountsService(
                    postRepository as unknown as KnexPostRepository,
                    fedifyContextFactory as unknown as FedifyContextFactory,
                );

            await postInteractionCountsService.refreshInteractionCounts(1);

            expect(
                postRepository.updateInteractionCounts,
            ).not.toHaveBeenCalled();
        });

        it('does not throw an error if the remote object does not expose like/repost collections', async () => {
            const postRepository = {
                getById: vi.fn().mockResolvedValue({
                    id: 1,
                    apId: 'https://example.com/posts/1',
                    likeCount: 3,
                    repostCount: 2,
                }),
                updateInteractionCounts: vi.fn(),
            };

            const note = new Note({
                id: new URL('https://example.com/posts/1'),
                url: new URL('https://example.com/posts/1'),
                content: 'Hello, world!',
                likes: null,
                shares: null,
            });

            const fedifyContextFactory = {
                getFedifyContext: vi.fn().mockReturnValue({
                    getDocumentLoader: vi.fn().mockResolvedValue({}),
                    lookupObject: vi.fn().mockResolvedValue(note),
                }),
            };

            const postInteractionCountsService =
                new PostInteractionCountsService(
                    postRepository as unknown as KnexPostRepository,
                    fedifyContextFactory as unknown as FedifyContextFactory,
                );

            await postInteractionCountsService.refreshInteractionCounts(1);

            expect(
                postRepository.updateInteractionCounts,
            ).not.toHaveBeenCalled();
        });

        it('does not throw an error if the remote object exposes like/repost as URLs', async () => {
            const postRepository = {
                getById: vi.fn().mockResolvedValue({
                    id: 1,
                    apId: 'https://example.com/posts/1',
                    likeCount: 3,
                    repostCount: 2,
                }),
                updateInteractionCounts: vi.fn(),
            };

            const note = new Note({
                id: new URL('https://example.com/posts/1'),
                url: new URL('https://example.com/posts/1'),
                content: 'Hello, world!',
                likes: new URL('https://example.com/likes'),
                shares: new URL('https://example.com/shares'),
            });

            const fedifyContextFactory = {
                getFedifyContext: vi.fn().mockReturnValue({
                    getDocumentLoader: vi.fn().mockResolvedValue({}),
                    lookupObject: vi.fn().mockResolvedValue(note),
                }),
            };

            const postInteractionCountsService =
                new PostInteractionCountsService(
                    postRepository as unknown as KnexPostRepository,
                    fedifyContextFactory as unknown as FedifyContextFactory,
                );

            await postInteractionCountsService.refreshInteractionCounts(1);

            expect(
                postRepository.updateInteractionCounts,
            ).not.toHaveBeenCalled();
        });
    });
});
