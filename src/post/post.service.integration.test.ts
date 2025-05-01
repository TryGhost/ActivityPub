import type { Account } from 'account/account.entity';
import { KnexAccountRepository } from 'account/account.repository.knex';
import { AccountService } from 'account/account.service';
import { FedifyContextFactory } from 'activitypub/fedify-context.factory';
import { AsyncEvents } from 'core/events';
import {
    type Error as Err,
    error as createError,
    getError,
    getValue,
    isError,
    ok,
} from 'core/result';
import type { Knex } from 'knex';
import { ModerationService } from 'moderation/moderation.service';
import type { GCPStorageService } from 'storage/gcloud-storage/gcp-storage.service';
import { createTestDb } from 'test/db';
import { type FixtureManager, createFixtureManager } from 'test/fixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Post, PostType } from './post.entity';
import { KnexPostRepository } from './post.repository.knex';
import { PostService } from './post.service';

describe('PostService', () => {
    let db: Knex;
    let postRepository: KnexPostRepository;
    let accountRepository: KnexAccountRepository;
    let fixtureManager: FixtureManager;
    let fedifyContextFactory: FedifyContextFactory;
    let storageService: GCPStorageService;
    let moderationService: ModerationService;
    let postService: PostService;
    let accountService: AccountService;
    let account: Account;
    let events: AsyncEvents;

    beforeEach(async () => {
        db = await createTestDb();
        events = new AsyncEvents();
        postRepository = new KnexPostRepository(db, events);
        accountRepository = new KnexAccountRepository(db, events);
        fixtureManager = createFixtureManager(db, events);
        fedifyContextFactory = new FedifyContextFactory();

        storageService = {
            verifyImageUrl: vi.fn().mockResolvedValue(ok(true)),
        } as unknown as GCPStorageService;

        moderationService = new ModerationService(db);

        accountService = new AccountService(
            db,
            events,
            accountRepository,
            fedifyContextFactory,
        );

        postService = new PostService(
            postRepository,
            accountService,
            fedifyContextFactory,
            storageService,
            moderationService,
        );

        // Reset the database before each test
        await fixtureManager.reset();

        // Create a test account
        [account] = await fixtureManager.createInternalAccount();
    });

    describe('createNote', () => {
        it('should create a note successfully', async () => {
            const content = 'This is a test note';

            const result = await postService.createNote(account, content);

            if (isError(result)) {
                throw new Error('Result should not be an error');
            }

            const post = getValue(result);
            expect(post).toBeInstanceOf(Post);
            expect(post.author.id).toBe(account.id);
            expect(post.content).toContain(content);
            expect(post.type).toBe(PostType.Note);
            expect(post.inReplyTo).toBeNull();

            // Verify the post was saved to database
            const savedPost = await postRepository.getById(post.id!);
            expect(savedPost).not.toBeNull();
            expect(savedPost!.id).toBe(post.id);
            expect(savedPost!.content).toContain(content);
        });

        it('should handle image URLs correctly', async () => {
            const content = 'This is a test note with an image';
            const imageUrl = new URL('https://example.com/image.jpg');

            const result = await postService.createNote(
                account,
                content,
                imageUrl,
            );

            if (isError(result)) {
                throw new Error('Result should not be an error');
            }

            const post = getValue(result);
            expect(post.imageUrl).toEqual(imageUrl);
        });

        it('should return error when image verification fails', async () => {
            const failingStorageService = {
                verifyImageUrl: vi
                    .fn()
                    .mockResolvedValue(createError('invalid-url')),
            } as unknown as GCPStorageService;

            const serviceWithFailingStorage = new PostService(
                postRepository,
                accountService,
                fedifyContextFactory,
                failingStorageService,
                moderationService,
            );

            const content = 'This is a test note';
            const imageUrl = new URL('https://example.com/bad-image.jpg');

            const result = await serviceWithFailingStorage.createNote(
                account,
                content,
                imageUrl,
            );

            expect(isError(result)).toBe(true);
            expect(getError(result as Err<string>)).toBe('invalid-url');
        });
    });

    describe('createReply', () => {
        it('should create a reply to a post successfully', async () => {
            // First create an original post to reply to
            const originalPost = await fixtureManager.createPost(account);
            const replyContent = 'This is a test reply';

            const result = await postService.createReply(
                account,
                replyContent,
                originalPost.apId,
            );

            if (isError(result)) {
                throw new Error('Result should not be an error');
            }

            const reply = getValue(result);
            expect(reply).toBeInstanceOf(Post);
            expect(reply.author.id).toBe(account.id);
            expect(reply.content).toContain(replyContent);
            expect(reply.type).toBe(PostType.Note);
            expect(reply.inReplyTo).toBe(originalPost.id);

            // Verify the reply was saved to database
            const savedReply = await postRepository.getById(reply.id!);
            expect(savedReply).not.toBeNull();
            expect(savedReply!.id).toBe(reply.id);
            expect(savedReply!.content).toContain(replyContent);
            expect(savedReply!.inReplyTo).toBe(originalPost.id);
        });

        it('should handle replying to external posts', async () => {
            // Create an external account
            const externalAccount =
                await fixtureManager.createExternalAccount();

            // Create a post for that external account
            const externalPost =
                await fixtureManager.createPost(externalAccount);

            const replyContent = 'This is a reply to an external post';

            const result = await postService.createReply(
                account,
                replyContent,
                externalPost.apId,
            );

            if (isError(result)) {
                throw new Error('Result should not be an error');
            }

            const reply = getValue(result);
            expect(reply.inReplyTo).toBe(externalPost.id);
        });

        it('should return error when replying to nonexistent post', async () => {
            const nonExistentPostUrl = new URL(
                'https://example.com/posts/nonexistent',
            );
            const replyContent = 'This reply will fail';

            // Mock the fedify context to simulate upstream error
            const mockFedifyContextFactory = {
                getFedifyContext: () => ({
                    getDocumentLoader: async () => ({}),
                }),
                asyncLocalStorage: {
                    getStore: vi.fn(),
                    run: vi.fn(),
                },
                registerContext: vi.fn(),
            } as unknown as FedifyContextFactory;

            const serviceWithMockContext = new PostService(
                postRepository,
                accountService,
                mockFedifyContextFactory,
                storageService,
                moderationService,
            );

            const result = await serviceWithMockContext.createReply(
                account,
                replyContent,
                nonExistentPostUrl,
            );

            if (!isError(result)) {
                throw new Error('Expected result to be an error');
            }
            expect(getError(result)).toBe('upstream-error');
        });

        it('should not allow replying to a post when blocked by the post author', async () => {
            // Create another account (post author)
            const [postAuthor] = await fixtureManager.createInternalAccount();

            // Create a post from the post author
            const originalPost = await fixtureManager.createPost(postAuthor);

            // Block the replier
            await fixtureManager.createBlock(postAuthor, account);

            const replyContent = 'This reply should not be allowed';

            const result = await postService.createReply(
                account,
                replyContent,
                originalPost.apId,
            );

            if (!isError(result)) {
                throw new Error('Expected result to be an error');
            }

            expect(getError(result)).toBe('cannot-interact');
        });
    });
});
