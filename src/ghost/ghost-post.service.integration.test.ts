import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Logger } from '@logtape/logtape';
import type { Knex } from 'knex';

import type { Account } from '@/account/account.entity';
import { KnexAccountRepository } from '@/account/account.repository.knex';
import { AccountService } from '@/account/account.service';
import type { FedifyContextFactory } from '@/activitypub/fedify-context.factory';
import { AsyncEvents } from '@/core/events';
import { getError, getValue, isError } from '@/core/result';
import { GhostPostService } from '@/ghost/ghost-post.service';
import { ModerationService } from '@/moderation/moderation.service';
import { Post } from '@/post/post.entity';
import { KnexPostRepository } from '@/post/post.repository.knex';
import { PostService } from '@/post/post.service';
import type { ImageStorageService } from '@/storage/image-storage.service';
import { createTestDb } from '@/test/db';
import { createFixtureManager, type FixtureManager } from '@/test/fixtures';

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
        logger = {
            info: vi.fn(),
            error: vi.fn(),
            warn: vi.fn(),
        } as unknown as Logger;
        postRepository = new KnexPostRepository(db, events, logger);
        accountRepository = new KnexAccountRepository(db, events);
        fixtureManager = createFixtureManager(db, events);
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

        ghostPostService = new GhostPostService(
            db,
            postService,
            postRepository,
            logger,
            events,
        );
        await ghostPostService.init();

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
            const initialResult = await ghostPostService.createGhostPost(
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

        it('should delete post when ghost post has missing content', async () => {
            const initialResult = await ghostPostService.createGhostPost(
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
            const initialResult = await ghostPostService.createGhostPost(
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
            const initialResult = await ghostPostService.createGhostPost(
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
            const ghostPostUuid = 'ee218320-b2e6-11ef-8a80-0242ac120008';

            // Initial post
            await ghostPostService.createGhostPost(account, {
                title: 'Test Article',
                uuid: ghostPostUuid,
                html: '<p>Original content</p>',
                excerpt: 'Original excerpt',
                custom_excerpt: null,
                feature_image: null,
                published_at: new Date().toISOString(),
                url: 'https://example.com/test-article',
                visibility: 'public',
                authors: [],
            });

            // Update the post
            const ghostPost = {
                title: 'Test Article with Authors',
                uuid: ghostPostUuid,
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

            const apIdForPost = await db('ghost_ap_post_mappings')
                .select('ap_id')
                .where('ghost_uuid', ghostPost.uuid)
                .first();
            expect(apIdForPost).not.toBeNull();
            const apId = new URL(apIdForPost.ap_id);
            const updatedPost = await postRepository.getByApId(apId);
            expect(updatedPost).not.toBeNull();
            expect(updatedPost!.metadata).toEqual({
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

    describe('createGhostPost', () => {
        it('should create a new ghost post successfully', async () => {
            const ghostPost = {
                title: 'New Ghost Post',
                uuid: 'ee218320-b2e6-11ef-8a80-0242ac120020',
                html: '<p>This is a new ghost post</p>',
                excerpt: 'New ghost post excerpt',
                custom_excerpt: 'Custom excerpt',
                feature_image: 'https://example.com/feature-image.jpg',
                published_at: new Date().toISOString(),
                url: 'https://example.com/new-ghost-post',
                visibility: 'public' as const,
                authors: [
                    {
                        name: 'Ghost Author',
                        profile_image: 'https://example.com/author.jpg',
                    },
                ],
            };

            const result = await ghostPostService.createGhostPost(
                account,
                ghostPost,
            );

            expect(isError(result)).toBe(false);
            if (isError(result)) {
                throw new Error('Failed to create ghost post');
            }
            const createdPost = getValue(result);

            // Verifying the post was created
            expect(createdPost.title).toBe('New Ghost Post');
            expect(createdPost.content).toContain('This is a new ghost post');
            expect(createdPost.excerpt).toBe('New ghost post excerpt');
            expect(createdPost.summary).toBe('Custom excerpt');
            expect(createdPost.imageUrl?.href).toBe(
                'https://example.com/feature-image.jpg',
            );

            // Verifying the mapping was created in the database
            const mappingResult = await db('ghost_ap_post_mappings')
                .select('*')
                .where('ghost_uuid', ghostPost.uuid)
                .first();

            expect(mappingResult).not.toBeNull();
            expect(mappingResult.ghost_uuid).toBe(ghostPost.uuid);
            expect(mappingResult.ap_id).toBe(createdPost.apId.href);
        });

        it('should return error when ghost post already exists', async () => {
            const ghostPost = {
                title: 'Existing Ghost Post',
                uuid: 'ee218320-b2e6-11ef-8a80-0242ac120021',
                html: '<p>This is an existing ghost post</p>',
                excerpt: 'Existing ghost post excerpt',
                custom_excerpt: null,
                feature_image: null,
                published_at: new Date().toISOString(),
                url: 'https://example.com/existing-ghost-post',
                visibility: 'public' as const,
                authors: [],
            };

            const firstResult = await ghostPostService.createGhostPost(
                account,
                ghostPost,
            );
            expect(isError(firstResult)).toBe(false);

            const secondResult = await ghostPostService.createGhostPost(
                account,
                ghostPost,
            );

            expect(isError(secondResult)).toBe(true);
            if (!isError(secondResult)) {
                throw new Error('Expected error but got success');
            }
            expect(getError(secondResult)).toBe('post-already-exists');
        });
    });

    describe('deleteGhostPost', () => {
        it('should delete an existing post successfully', async () => {
            const uuid = 'ee218320-b2e6-11ef-8a80-0242ac120009';

            const initialResult = await ghostPostService.createGhostPost(
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

        it('should remove ghost post mapping when post is deleted', async () => {
            const uuid = 'ee218320-b2e6-11ef-8a80-0242ac120011';

            const createResult = await ghostPostService.createGhostPost(
                account,
                {
                    title: 'Test Article for Mapping Deletion',
                    uuid,
                    html: '<p>Content that will be deleted</p>',
                    excerpt: 'Test excerpt',
                    custom_excerpt: null,
                    feature_image: null,
                    published_at: new Date().toISOString(),
                    url: 'https://example.com/test-article-mapping-deletion',
                    visibility: 'public',
                    authors: [],
                },
            );

            expect(isError(createResult)).toBe(false);
            if (isError(createResult)) {
                throw new Error('Failed to create initial post');
            }

            const mappingBeforeDeletion = await db('ghost_ap_post_mappings')
                .select('*')
                .where('ghost_uuid', uuid)
                .first();

            expect(mappingBeforeDeletion).not.toBeNull();
            expect(mappingBeforeDeletion.ghost_uuid).toBe(uuid);

            const deleteResult = await ghostPostService.deleteGhostPost(
                account,
                uuid,
            );
            expect(isError(deleteResult)).toBe(false);

            const mappingAfterDeletion = await db('ghost_ap_post_mappings')
                .select('*')
                .where('ghost_uuid', uuid)
                .first();

            expect(mappingAfterDeletion).toBeUndefined();
        });
    });
});
