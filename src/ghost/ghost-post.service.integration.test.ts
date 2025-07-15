import type { Logger } from '@logtape/logtape';
import type { Account } from 'account/account.entity';
import { KnexAccountRepository } from 'account/account.repository.knex';
import { AccountService } from 'account/account.service';
import type { FedifyContextFactory } from 'activitypub/fedify-context.factory';
import { AsyncEvents } from 'core/events';
import { getValue, isError } from 'core/result';
import type { Knex } from 'knex';
import { ModerationService } from 'moderation/moderation.service';
import { Post, PostType } from 'post/post.entity';
import { KnexPostRepository } from 'post/post.repository.knex';
import { PostService } from 'post/post.service';
import type { ImageStorageService } from 'storage/image-storage.service';
import { createTestDb } from 'test/db';
import { type FixtureManager, createFixtureManager } from 'test/fixtures';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GhostPostService } from './ghost-post.service';

describe('GhostPostService', () => {
    let db: Knex;
    let postRepository: KnexPostRepository;
    let accountRepository: KnexAccountRepository;
    let fixtureManager: FixtureManager;
    let mockFedifyContextFactory: FedifyContextFactory;
    let imageStorageService: ImageStorageService;
    let moderationService: ModerationService;
    let postService: PostService;
    let accountService: AccountService;
    let ghostPostService: GhostPostService;
    let account: Account;
    let events: AsyncEvents;
    let logger: Logger;

    beforeEach(async () => {
        db = await createTestDb();
        events = new AsyncEvents();
        postRepository = new KnexPostRepository(db, events);
        accountRepository = new KnexAccountRepository(db, events);
        fixtureManager = createFixtureManager(db, events);
        logger = {
            info: vi.fn(),
            error: vi.fn(),
            warn: vi.fn(),
        } as unknown as Logger;
        mockFedifyContextFactory = {
            getFedifyContext: () => ({
                getDocumentLoader: async () => ({}),
                data: {
                    logger: {
                        info: vi.fn(),
                        error: vi.fn(),
                        warn: vi.fn(),
                    },
                },
            }),
            asyncLocalStorage: {
                getStore: vi.fn(),
                run: vi.fn(),
            },
            registerContext: vi.fn(),
        } as unknown as FedifyContextFactory;

        imageStorageService = {
            verifyFileUrl: vi.fn().mockResolvedValue({ success: true }),
        } as unknown as ImageStorageService;

        moderationService = new ModerationService(db);

        accountService = new AccountService(
            db,
            events,
            accountRepository,
            mockFedifyContextFactory,
        );

        postService = new PostService(
            postRepository,
            accountService,
            mockFedifyContextFactory,
            imageStorageService,
            moderationService,
            logger,
        );

        ghostPostService = new GhostPostService(postService, logger);

        // Reset the database before each test
        await fixtureManager.reset();

        // Create a test account
        [account] = await fixtureManager.createInternalAccount();
    });

    afterEach(async () => {
        // Clean up database connections
        await db.destroy();
    });

    describe('updateArticleFromGhostPost', () => {
        it('should update an existing article post successfully', async () => {
            const ghostPost = {
                title: 'Updated Test Article',
                uuid: 'ee218320-b2e6-11ef-8a80-0242ac120002',
                html: '<p>This is updated content</p>',
                excerpt: 'Updated excerpt',
                custom_excerpt: 'Updated custom excerpt',
                feature_image: 'https://example.com/updated-image.jpg',
                published_at: new Date().toISOString(),
                url: 'https://example.com/updated-test-article',
                visibility: 'public' as const,
                authors: [],
            };

            // Creating initial post
            const initialResult = await postService.handleIncomingGhostPost(
                account,
                {
                    title: 'Original Test Article',
                    uuid: 'ee218320-b2e6-11ef-8a80-0242ac120002',
                    html: '<p>Original content</p>',
                    excerpt: 'Original excerpt',
                    custom_excerpt: null,
                    feature_image: null,
                    published_at: new Date().toISOString(),
                    url: 'https://example.com/original-test-article',
                    visibility: 'public',
                    authors: [],
                },
            );

            expect(isError(initialResult)).toBe(false);
            if (isError(initialResult)) {
                throw new Error('Failed to create initial post');
            }
            const initialPost = getValue(initialResult);

            await ghostPostService.updateArticleFromGhostPost(
                account,
                ghostPost,
            );

            // Verify the post was updated
            const updatedPost = await postRepository.getById(initialPost.id!);
            expect(updatedPost).not.toBeNull();
            expect(updatedPost!.title).toBe('Updated Test Article');
            expect(updatedPost!.content).toContain('This is updated content');
            expect(updatedPost!.excerpt).toBe('Updated excerpt');
            expect(updatedPost!.imageUrl?.href).toBe(
                'https://example.com/updated-image.jpg',
            );
            expect(updatedPost!.url.href).toBe(
                'https://example.com/updated-test-article',
            );
        });

        it('should create a new post when the post does not exist', async () => {
            const ghostPost = {
                title: 'New Test Article',
                uuid: 'ee218320-b2e6-11ef-8a80-0242ac120003',
                html: '<p>This is new content</p>',
                excerpt: 'New excerpt',
                custom_excerpt: null,
                feature_image: null,
                published_at: new Date().toISOString(),
                url: 'https://example.com/new-test-article',
                visibility: 'public' as const,
                authors: [],
            };

            const handleIncomingGhostPostSpy = vi.spyOn(
                postService,
                'handleIncomingGhostPost',
            );

            await ghostPostService.updateArticleFromGhostPost(
                account,
                ghostPost,
            );

            expect(handleIncomingGhostPostSpy).toHaveBeenCalledWith(
                account,
                ghostPost,
            );

            const apId = account.getApIdForPost({
                uuid: ghostPost.uuid,
                type: PostType.Article,
            });
            const createdPost = await postRepository.getByApId(apId);
            expect(createdPost).not.toBeNull();
            expect(createdPost!.title).toBe('New Test Article');
            expect(createdPost!.content).toContain('This is new content');
        });

        it('should delete post when ghost post has missing content', async () => {
            const initialResult = await postService.handleIncomingGhostPost(
                account,
                {
                    title: 'Test Article',
                    uuid: 'ee218320-b2e6-11ef-8a80-0242ac120004',
                    html: '<p>Original content</p>',
                    excerpt: 'Original excerpt',
                    custom_excerpt: null,
                    feature_image: null,
                    published_at: new Date().toISOString(),
                    url: 'https://example.com/test-article',
                    visibility: 'public',
                    authors: [],
                },
            );

            expect(isError(initialResult)).toBe(false);
            if (isError(initialResult)) {
                throw new Error('Failed to create initial post');
            }
            const initialPost = getValue(initialResult);

            const ghostPostWithMissingContent = {
                title: 'Test Article',
                uuid: 'ee218320-b2e6-11ef-8a80-0242ac120004',
                html: null,
                excerpt: 'Test excerpt',
                custom_excerpt: null,
                feature_image: null,
                published_at: new Date().toISOString(),
                url: 'https://example.com/test-article',
                visibility: 'public' as const,
                authors: [],
            };

            const deleteByApIdSpy = vi.spyOn(postService, 'deleteByApId');

            await ghostPostService.updateArticleFromGhostPost(
                account,
                ghostPostWithMissingContent,
            );

            expect(deleteByApIdSpy).toHaveBeenCalledWith(
                initialPost.apId,
                account,
            );

            const deletedPost = await postRepository.getById(initialPost.id!);
            expect(deletedPost).not.toBeNull();
            expect(Post.isDeleted(deletedPost!)).toBe(true);
        });

        it('should delete post when ghost post is private', async () => {
            const initialResult = await postService.handleIncomingGhostPost(
                account,
                {
                    title: 'Test Article',
                    uuid: 'ee218320-b2e6-11ef-8a80-0242ac120005',
                    html: '<p>Original content</p>',
                    excerpt: 'Original excerpt',
                    custom_excerpt: null,
                    feature_image: null,
                    published_at: new Date().toISOString(),
                    url: 'https://example.com/test-article',
                    visibility: 'public',
                    authors: [],
                },
            );

            expect(isError(initialResult)).toBe(false);
            if (isError(initialResult)) {
                throw new Error('Failed to create initial post');
            }
            const initialPost = getValue(initialResult);

            const privateGhostPost = {
                title: 'Test Article',
                uuid: 'ee218320-b2e6-11ef-8a80-0242ac120005',
                html: '<p>Original content</p>',
                excerpt: 'Test excerpt',
                custom_excerpt: null,
                feature_image: null,
                published_at: new Date().toISOString(),
                url: 'https://example.com/test-article',
                visibility: 'members' as const,
                authors: [],
            };

            const deleteByApIdSpy = vi.spyOn(postService, 'deleteByApId');

            await ghostPostService.updateArticleFromGhostPost(
                account,
                privateGhostPost,
            );

            expect(deleteByApIdSpy).toHaveBeenCalledWith(
                initialPost.apId,
                account,
            );

            const deletedPost = await postRepository.getById(initialPost.id!);
            expect(deletedPost).not.toBeNull();
            expect(Post.isDeleted(deletedPost!)).toBe(true);
        });

        it('should handle posts with all optional fields', async () => {
            const ghostPost = {
                title: 'Minimal Test Article',
                uuid: 'ee218320-b2e6-11ef-8a80-0242ac120007',
                html: '<p>Minimal content</p>',
                excerpt: null,
                custom_excerpt: null,
                feature_image: null,
                published_at: new Date().toISOString(),
                url: 'https://example.com/minimal-test-article',
                visibility: 'public' as const,
                authors: [],
            };

            // First create the initial post
            const initialResult = await postService.handleIncomingGhostPost(
                account,
                ghostPost,
            );
            expect(isError(initialResult)).toBe(false);
            if (isError(initialResult)) {
                throw new Error('Failed to create initial post');
            }
            const initialPost = getValue(initialResult);

            await ghostPostService.updateArticleFromGhostPost(
                account,
                ghostPost,
            );

            // Verify the post still exists and has the correct values
            const updatedPost = await postRepository.getById(initialPost.id!);
            expect(updatedPost).not.toBeNull();
            expect(updatedPost!.title).toBe('Minimal Test Article');
            expect(updatedPost!.content).toContain('Minimal content');
            expect(updatedPost!.excerpt).toBeNull();
            expect(updatedPost!.imageUrl).toBeNull();
        });

        it('should handle posts with ghost authors metadata', async () => {
            const ghostPost = {
                title: 'Test Article with Authors',
                uuid: 'ee218320-b2e6-11ef-8a80-0242ac120008',
                html: '<p>Content with authors</p>',
                excerpt: 'Test excerpt',
                custom_excerpt: null,
                feature_image: null,
                published_at: new Date().toISOString(),
                url: 'https://example.com/test-article-with-authors',
                visibility: 'public' as const,
                authors: [
                    {
                        name: 'John Doe',
                        profile_image: 'https://example.com/john.jpg',
                    },
                    { name: 'Jane Smith', profile_image: null },
                ],
            };

            await ghostPostService.updateArticleFromGhostPost(
                account,
                ghostPost,
            );

            const apId = account.getApIdForPost({
                uuid: ghostPost.uuid,
                type: PostType.Article,
            });
            const createdPost = await postRepository.getByApId(apId);
            expect(createdPost).not.toBeNull();
            expect(createdPost!.metadata).toEqual({
                ghostAuthors: [
                    {
                        name: 'John Doe',
                        profile_image: 'https://example.com/john.jpg',
                    },
                    { name: 'Jane Smith', profile_image: null },
                ],
            });
        });
    });

    describe('deleteGhostPost', () => {
        it('should delete an existing post successfully', async () => {
            const uuid = 'ee218320-b2e6-11ef-8a80-0242ac120009';

            const initialResult = await postService.handleIncomingGhostPost(
                account,
                {
                    title: 'Test Article to Delete',
                    uuid,
                    html: '<p>Content to be deleted</p>',
                    excerpt: 'Test excerpt',
                    custom_excerpt: null,
                    feature_image: null,
                    published_at: new Date().toISOString(),
                    url: 'https://example.com/test-article-to-delete',
                    visibility: 'public',
                    authors: [],
                },
            );

            expect(isError(initialResult)).toBe(false);
            if (isError(initialResult)) {
                throw new Error('Failed to create initial post');
            }
            const initialPost = getValue(initialResult);

            const postBeforeDeletion = await postRepository.getById(
                initialPost.id!,
            );
            expect(postBeforeDeletion).not.toBeNull();
            expect(Post.isDeleted(postBeforeDeletion!)).toBe(false);

            await ghostPostService.deleteGhostPost(account, uuid);

            const deletedPost = await postRepository.getById(initialPost.id!);
            expect(deletedPost).not.toBeNull();
            expect(Post.isDeleted(deletedPost!)).toBe(true);
        });

        it('should log error when deletion fails', async () => {
            const uuid = 'ee218320-b2e6-11ef-8a80-0242ac120010';

            const deleteByApIdSpy = vi
                .spyOn(postService, 'deleteByApId')
                .mockResolvedValue(['not-author', null]);

            await ghostPostService.deleteGhostPost(account, uuid);

            const apId = account.getApIdForPost({
                uuid,
                type: PostType.Article,
            });

            expect(deleteByApIdSpy).toHaveBeenCalledWith(apId, account);
            expect(logger.error).toHaveBeenCalledWith(
                'Failed to delete post with apId: {apId}, error: {error}',
                { apId, error: 'not-author' },
            );
        });
    });
});
