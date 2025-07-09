import {
    Collection,
    Document,
    Image,
    Link,
    Note,
    lookupObject,
} from '@fedify/fedify';
import { Temporal } from '@js-temporal/polyfill';
import type { Logger } from '@logtape/logtape';
import type { Account } from 'account/account.entity';
import { KnexAccountRepository } from 'account/account.repository.knex';
import { AccountService } from 'account/account.service';
import type { FedifyContextFactory } from 'activitypub/fedify-context.factory';
import { AsyncEvents } from 'core/events';
import {
    type Error as Err,
    error as createError,
    error,
    getError,
    getValue,
    isError,
    ok,
} from 'core/result';
import type { Knex } from 'knex';
import { ModerationService } from 'moderation/moderation.service';
import type { ImageStorageService } from 'storage/image-storage.service';
import { createTestDb } from 'test/db';
import { type FixtureManager, createFixtureManager } from 'test/fixtures';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OutboxType, Post, PostType } from './post.entity';
import { KnexPostRepository } from './post.repository.knex';
import { PostService } from './post.service';

vi.mock('@fedify/fedify', async () => {
    const actual = await vi.importActual('@fedify/fedify');
    return {
        ...actual,
        lookupObject: vi.fn().mockResolvedValue(null),
    };
});

describe('PostService', () => {
    let db: Knex;
    let postRepository: KnexPostRepository;
    let accountRepository: KnexAccountRepository;
    let fixtureManager: FixtureManager;
    let mockFedifyContextFactory: FedifyContextFactory;
    let imageStorageService: ImageStorageService;
    let moderationService: ModerationService;
    let postService: PostService;
    let accountService: AccountService;
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

        // Mock the lookup functions
        vi.mock('lookup-helpers', async () => {
            const original = await vi.importActual('lookup-helpers');

            return {
                ...original,
                lookupActorProfile: vi
                    .fn()
                    .mockImplementation(async (ctx, handle) => {
                        // Extract username and domain from handle
                        const match = handle.match(/@?([^@]+)@(.+)/);
                        if (!match) return error('lookup-error');
                        const [, username, domain] = match;
                        return ok(new URL(`https://${domain}/${username}`));
                    }),
            };
        });

        imageStorageService = {
            verifyFileUrl: vi.fn().mockResolvedValue(ok(true)),
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

        // Reset the database before each test
        await fixtureManager.reset();

        // Create a test account
        [account] = await fixtureManager.createInternalAccount();
    });

    afterEach(async () => {
        // Clean up database connections
        await db.destroy();
    });

    describe('handleIncomingGhostPost', () => {
        it('should create a post successfully', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            const result = await postService.handleIncomingGhostPost(account, {
                title: 'Test Post',
                uuid: 'ee218320-b2e6-11ef-8a80-0242ac120002',
                html: 'This is a test post',
                excerpt: 'This is a test post',
                custom_excerpt: null,
                feature_image: null,
                published_at: new Date().toISOString(),
                url: 'https://example.com/test-post',
                visibility: 'public',
                authors: [],
            });

            if (isError(result)) {
                throw new Error('Result should not be an error');
            }

            const post = getValue(result);
            expect(post).toBeInstanceOf(Post);
            expect(post.author.id).toBe(account.id);
            expect(post.uuid).toBe('ee218320-b2e6-11ef-8a80-0242ac120002');
        });

        it('should return an error if the post already exists', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            await postService.handleIncomingGhostPost(account, {
                title: 'Test Post',
                uuid: 'ee218320-b2e6-11ef-8a80-0242ac120002',
                html: 'This is a test post',
                excerpt: 'This is a test post',
                custom_excerpt: null,
                feature_image: null,
                published_at: new Date().toISOString(),
                url: 'https://example.com/test-post',
                visibility: 'public',
                authors: [],
            });

            const result = await postService.handleIncomingGhostPost(account, {
                title: 'Test Post',
                uuid: 'ee218320-b2e6-11ef-8a80-0242ac120002',
                html: 'This is a test post',
                excerpt: 'This is a test post',
                custom_excerpt: null,
                feature_image: null,
                published_at: new Date().toISOString(),
                url: 'https://example.com/test-post',
                visibility: 'public',
                authors: [],
            });

            if (!isError(result)) {
                throw new Error('Result should be an error');
            }

            const error = getError(result);
            expect(error).toBe('post-already-exists');
        });
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

            const result = await postService.createNote(account, content, {
                url: imageUrl,
            });

            if (isError(result)) {
                throw new Error('Result should not be an error');
            }

            const post = getValue(result);
            expect(post.attachments).toEqual([
                {
                    type: 'Image',
                    mediaType: null,
                    name: null,
                    url: new URL(imageUrl),
                },
            ]);
        });

        it('should handle image URLs and alt text correctly', async () => {
            const content = 'This is a test note with an image';
            const imageUrl = new URL('https://example.com/image.jpg');

            const result = await postService.createNote(account, content, {
                url: imageUrl,
                altText: 'Image alt text',
            });

            if (isError(result)) {
                throw new Error('Result should not be an error');
            }

            const post = getValue(result);
            expect(post.attachments).toEqual([
                {
                    type: 'Image',
                    mediaType: null,
                    name: 'Image alt text',
                    url: new URL(imageUrl),
                },
            ]);
        });

        it('should return error when image verification fails', async () => {
            const failingStorageService = {
                verifyFileUrl: vi
                    .fn()
                    .mockResolvedValue(createError('invalid-url')),
            } as unknown as ImageStorageService;

            const serviceWithFailingStorage = new PostService(
                postRepository,
                accountService,
                mockFedifyContextFactory,
                failingStorageService,
                moderationService,
                logger,
            );

            const content = 'This is a test note';

            const result = await serviceWithFailingStorage.createNote(
                account,
                content,
                {
                    url: new URL('https://example.com/bad-image.jpg'),
                },
            );

            expect(isError(result)).toBe(true);
            expect(getError(result as Err<string>)).toBe('invalid-url');
        });

        it('should store mentions in database and format them in content', async () => {
            // Create an external account to mention
            const mentionedAccount =
                await fixtureManager.createExternalAccount();

            const content = `This is a test note mentioning @${mentionedAccount.username}@${mentionedAccount.apId.hostname}`;

            const result = await postService.createNote(account, content);

            if (isError(result)) {
                throw new Error('Result should not be an error');
            }

            const post = getValue(result);
            expect(post).toBeInstanceOf(Post);
            expect(post.author.id).toBe(account.id);
            expect(post.type).toBe(PostType.Note);

            // Verify mention is wrapped in hyperlink in content
            expect(post.content).toBe(
                `<p>This is a test note mentioning <a href="${mentionedAccount.apId}" data-profile="@${mentionedAccount.username}@${mentionedAccount.apId.hostname}" rel="nofollow noopener noreferrer">@${mentionedAccount.username}@${mentionedAccount.apId.hostname}</a></p>`,
            );

            // Verify the post was saved to database
            const savedPost = await postRepository.getById(post.id!);
            expect(savedPost).not.toBeNull();
            expect(savedPost!.id).toBe(post.id);

            // Verify mention is stored in database
            const mentionInDb = await db('mentions')
                .where({
                    post_id: post.id,
                    account_id: mentionedAccount.id,
                })
                .first();
            expect(mentionInDb).not.toBeNull();
            expect(mentionInDb.post_id).toBe(post.id);
            expect(mentionInDb.account_id).toBe(mentionedAccount.id);
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

            const result = await postService.createReply(
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

        it('should store mentions in database and format them in content', async () => {
            // Create an original post to reply to
            const originalPost = await fixtureManager.createPost(account);

            // Create an external account to mention
            const mentionedAccount =
                await fixtureManager.createExternalAccount();

            const replyContent = `This is a reply mentioning @${mentionedAccount.username}@${mentionedAccount.apId.hostname}`;

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
            expect(reply.type).toBe(PostType.Note);
            expect(reply.inReplyTo).toBe(originalPost.id);

            // Verify mention is wrapped in hyperlink in content
            expect(reply.content).toBe(
                `<p>This is a reply mentioning <a href="${mentionedAccount.apId}" data-profile="@${mentionedAccount.username}@${mentionedAccount.apId.hostname}" rel="nofollow noopener noreferrer">@${mentionedAccount.username}@${mentionedAccount.apId.hostname}</a></p>`,
            );

            // Verify the reply was saved to database
            const savedReply = await postRepository.getById(reply.id!);
            expect(savedReply).not.toBeNull();
            expect(savedReply!.id).toBe(reply.id);
            expect(savedReply!.inReplyTo).toBe(originalPost.id);

            // Verify mention is stored in database
            const mentionInDb = await db('mentions')
                .where({
                    post_id: reply.id,
                    account_id: mentionedAccount.id,
                })
                .first();
            expect(mentionInDb).not.toBeNull();
            expect(mentionInDb.post_id).toBe(reply.id);
            expect(mentionInDb.account_id).toBe(mentionedAccount.id);
        });
    });

    describe('likePost', () => {
        it('should like a post successfully', async () => {
            const [likeAccount] = await fixtureManager.createInternalAccount();

            const post = await fixtureManager.createPost(account);

            const result = await postService.likePost(likeAccount, post);

            expect(isError(result)).toBe(false);

            const postWasLiked = await postRepository.isLikedByAccount(
                post.id!,
                likeAccount.id,
            );

            expect(postWasLiked).toBe(true);
        });

        it('should return error when moderation check fails', async () => {
            const [accountToBlock] =
                await fixtureManager.createInternalAccount();

            const post = await fixtureManager.createPost(account);

            await fixtureManager.createBlock(account, accountToBlock);

            const result = await postService.likePost(accountToBlock, post);

            expect(isError(result)).toBe(true);
            expect(getError(result as Err<string>)).toBe('cannot-interact');

            const postWasLiked = await postRepository.isLikedByAccount(
                post.id!,
                accountToBlock.id,
            );

            expect(postWasLiked).toBe(false);
        });
    });

    describe('repostByApId', () => {
        it('should repost a post successfully', async () => {
            // Create a post to repost
            const postToRepost = await fixtureManager.createPost(account);

            // Create another account to repost the post
            const [reposter] = await fixtureManager.createInternalAccount();

            const result = await postService.repostByApId(
                reposter,
                postToRepost.apId,
            );

            if (isError(result)) {
                throw new Error('Result should not be an error');
            }

            const repostedPost = getValue(result);
            expect(repostedPost.id).toBe(postToRepost.id);

            // Verify the post was reposted
            const wasReposted = await postService.isRepostedByAccount(
                repostedPost.id!,
                reposter.id,
            );
            expect(wasReposted).toBe(true);
        });

        it('should handle reposting an external post', async () => {
            // Create an external account
            const externalAccount =
                await fixtureManager.createExternalAccount();

            // Create a post from the external account
            const externalPost =
                await fixtureManager.createPost(externalAccount);

            const result = await postService.repostByApId(
                account,
                externalPost.apId,
            );

            if (isError(result)) {
                throw new Error('Result should not be an error');
            }

            const repostedPost = getValue(result);
            expect(repostedPost.id).toBe(externalPost.id);

            // Verify the post was reposted
            const wasReposted = await postService.isRepostedByAccount(
                repostedPost.id!,
                account.id,
            );
            expect(wasReposted).toBe(true);
        });

        it('should return error when trying to repost a nonexistent post', async () => {
            const nonExistentPostUrl = new URL(
                'https://example.com/posts/nonexistent',
            );

            const result = await postService.repostByApId(
                account,
                nonExistentPostUrl,
            );

            if (!isError(result)) {
                throw new Error('Expected result to be an error');
            }
            expect(getError(result)).toBe('upstream-error');
        });

        it('should return error when trying to repost an already reposted post', async () => {
            // Create a post to repost
            const postToRepost = await fixtureManager.createPost(account);

            // Create another account to repost the post
            const [reposter] = await fixtureManager.createInternalAccount();

            // Repost the post once and make sure it succeeds
            const firstRepost = await postService.repostByApId(
                reposter,
                postToRepost.apId,
            );
            expect(isError(firstRepost)).toBe(false);

            // Try to repost it again
            const result = await postService.repostByApId(
                reposter,
                postToRepost.apId,
            );

            if (!isError(result)) {
                throw new Error('Expected result to be an error');
            }
            expect(getError(result)).toBe('already-reposted');
        });

        it('should not allow reposting a post when blocked by the post author', async () => {
            // Create another account (post author)
            const [postAuthor] = await fixtureManager.createInternalAccount();

            // Create a post from the post author
            const originalPost = await fixtureManager.createPost(postAuthor);

            // Block the reposter
            await fixtureManager.createBlock(postAuthor, account);

            const result = await postService.repostByApId(
                account,
                originalPost.apId,
            );

            if (!isError(result)) {
                throw new Error('Expected result to be an error');
            }

            expect(getError(result)).toBe('cannot-interact');

            // Verify the post was not reposted
            const wasReposted = await postService.isRepostedByAccount(
                originalPost.id!,
                account.id,
            );
            expect(wasReposted).toBe(false);
        });
    });

    describe('updateInteractionCounts', () => {
        it('returns an error if called for an internal account', async () => {
            const [author, _site, _number] =
                await fixtureManager.createInternalAccount();
            const post = await fixtureManager.createPost(author);

            const result = await postService.updateInteractionCounts(post);

            expect(isError(result)).toBe(true);
            expect(getError(result as Err<string>)).toBe('post-is-internal');
        });

        it('returns an error if the remote object is not found', async () => {
            const author = await fixtureManager.createExternalAccount();
            const post = await fixtureManager.createPost(author);

            const result = await postService.updateInteractionCounts(post);

            expect(isError(result)).toBe(true);
            expect(getError(result as Err<string>)).toBe('upstream-error');
        });

        it('does not update interaction counts if the counts have not changed', async () => {
            const author = await fixtureManager.createExternalAccount();
            const post = await fixtureManager.createPost(author);

            // Add 2 likes and 1 repost
            const [likeAccount1] = await fixtureManager.createInternalAccount();
            const [likeAccount2] = await fixtureManager.createInternalAccount();
            const [repostAccount] =
                await fixtureManager.createInternalAccount();

            await postService.likePost(likeAccount1, post);
            await postService.likePost(likeAccount2, post);
            await postService.repostByApId(repostAccount, post.apId);

            const updatedPost = await postRepository.getById(post.id!);

            // Set up spies on the post methods
            const setLikeCountSpy = vi.spyOn(post, 'setLikeCount');
            const setRepostCountSpy = vi.spyOn(post, 'setRepostCount');

            // Now try to update the interactions with the same counts
            vi.mocked(lookupObject).mockResolvedValue(
                new Note({
                    id: post.apId,
                    likes: new Collection({
                        totalItems: 2,
                    }),
                    shares: new Collection({
                        totalItems: 1,
                    }),
                }),
            );
            const result = await postService.updateInteractionCounts(
                updatedPost!,
            );

            expect(isError(result)).toBe(false);
            expect(setLikeCountSpy).not.toHaveBeenCalled();
            expect(setRepostCountSpy).not.toHaveBeenCalled();

            // Check that the post's like and repost counts have not changed
            const savedPost = await postRepository.getById(post.id!);
            expect(savedPost).not.toBeNull();
            expect(savedPost!.likeCount).toBe(2);
            expect(savedPost!.repostCount).toBe(1);
        });

        it('updates interaction counts if the counts have changed', async () => {
            const author = await fixtureManager.createExternalAccount();
            const post = await fixtureManager.createPost(author);

            // Add 2 likes and 1 repost
            const [likeAccount1] = await fixtureManager.createInternalAccount();
            const [likeAccount2] = await fixtureManager.createInternalAccount();
            const [repostAccount] =
                await fixtureManager.createInternalAccount();

            await postService.likePost(likeAccount1, post);
            await postService.likePost(likeAccount2, post);
            await postService.repostByApId(repostAccount, post.apId);

            const updatedPost = await postRepository.getById(post.id!);

            // Now update interactions counts (there is one more like and one less repost)
            vi.mocked(lookupObject).mockResolvedValue(
                new Note({
                    id: post.apId,
                    likes: new Collection({
                        totalItems: 3,
                    }),
                    shares: new Collection({
                        totalItems: 0,
                    }),
                }),
            );
            const result = await postService.updateInteractionCounts(
                updatedPost!,
            );

            expect(isError(result)).toBe(false);

            // Check that the post's like and repost counts have changed
            const savedPost = await postRepository.getById(post.id!);
            expect(savedPost).not.toBeNull();
            expect(savedPost!.likeCount).toBe(3);
            expect(savedPost!.repostCount).toBe(0);
        });
    });

    describe('getByApId', () => {
        it('should handle attachments correctly for incoming posts with Image type attachment', async () => {
            const author = await fixtureManager.createExternalAccount();
            const attachmentUrl = new URL('https://example.com/image.jpg');

            vi.mocked(lookupObject).mockResolvedValue(
                new Note({
                    id: new URL('https://example.com/post/1'),
                    content: 'Test post with attachment',
                    attachments: [
                        new Image({
                            url: attachmentUrl,
                        }),
                    ],
                    attribution: author.apId,
                    published: Temporal.Now.instant(),
                }),
            );

            const result = await postService.getByApId(
                new URL('https://example.com/post/1'),
            );

            if (isError(result)) {
                throw new Error('Result should not be an error');
            }

            const post = getValue(result);
            expect(post.attachments).toHaveLength(1);
            expect(post.attachments[0]).toMatchObject({
                type: 'Image',
                url: attachmentUrl,
            });
        });

        it('should handle attachments correctly for incoming posts with Document type attachment', async () => {
            const author = await fixtureManager.createExternalAccount();
            const attachmentUrl = new URL('https://example.com/image.jpg');

            vi.mocked(lookupObject).mockResolvedValue(
                new Note({
                    id: new URL('https://example.com/post/1'),
                    content: 'Test post with attachment',
                    attachments: [
                        new Document({
                            url: attachmentUrl,
                            mediaType: 'image/jpeg',
                        }),
                    ],
                    attribution: author.apId,
                    published: Temporal.Now.instant(),
                }),
            );

            const result = await postService.getByApId(
                new URL('https://example.com/post/1'),
            );

            if (isError(result)) {
                throw new Error('Result should not be an error');
            }

            const post = getValue(result);
            expect(post.attachments).toHaveLength(1);
            expect(post.attachments[0]).toMatchObject({
                type: 'Document',
                mediaType: 'image/jpeg',
                url: attachmentUrl,
            });
        });

        it('should handle attachments correctly for incoming posts with multiple urls', async () => {
            const author = await fixtureManager.createExternalAccount();

            vi.mocked(lookupObject).mockResolvedValue(
                new Note({
                    id: new URL('https://example.com/post/1'),
                    content: 'Test post with attachment',
                    attachments: [
                        new Document({
                            urls: [
                                new Link({
                                    href: new URL(
                                        'https://example.com/image.jpg',
                                    ),
                                    mediaType: 'image/jpeg',
                                }),
                                new Link({
                                    href: new URL(
                                        'https://example.com/image.avif',
                                    ),
                                    mediaType: 'image/avif',
                                }),
                            ],
                        }),
                    ],
                    attribution: author.apId,
                    published: Temporal.Now.instant(),
                }),
            );

            const result = await postService.getByApId(
                new URL('https://example.com/post/1'),
            );

            if (isError(result)) {
                throw new Error('Result should not be an error');
            }

            const post = getValue(result);
            expect(post.attachments).toHaveLength(1);
            expect(post.attachments[0]).toMatchObject({
                type: 'Document',
                mediaType: 'image/jpeg',
                url: new URL('https://example.com/image.jpg'),
            });
        });
    });

    describe('getOutboxForAccount', () => {
        it('should return posts and reposts for an account with pagination', async () => {
            //Original Post 1
            const post1 = await fixtureManager.createPost(account);

            //Post Reposted by account
            const [authorAccount2] =
                await fixtureManager.createInternalAccount();
            const post2 = await fixtureManager.createPost(authorAccount2);
            post2.addRepost(account);
            await postRepository.save(post2);

            //Original Post 2
            const post3 = await fixtureManager.createPost(account);

            // Get first page
            const firstPage = await postService.getOutboxForAccount(
                account.id,
                new Date().toISOString(),
                2,
            );

            expect(firstPage.items).toHaveLength(2);
            expect(firstPage.items[0].post.id).toBe(post3.id);
            expect(firstPage.items[0].type).toBe(OutboxType.Original);
            expect(firstPage.items[1].post.id).toBe(post2.id);
            expect(firstPage.items[1].type).toBe(OutboxType.Repost);
            expect(firstPage.nextCursor).toBeTruthy();

            // Get second page
            const secondPage = await postService.getOutboxForAccount(
                account.id,
                firstPage.nextCursor,
                2,
            );

            expect(secondPage.items).toHaveLength(1);
            expect(secondPage.items[0].post.id).toBe(post1.id);
            expect(secondPage.items[0].type).toBe(OutboxType.Original);
            expect(secondPage.nextCursor).toBeNull();
        });

        it('should return empty array for account with no posts', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            const outbox = await postService.getOutboxForAccount(
                account.id,
                new Date().toISOString(),
                10,
            );

            expect(outbox.items).toHaveLength(0);
            expect(outbox.nextCursor).toBeNull();
        });
    });

    describe('getOutboxItemCount', () => {
        it('should return correct count of posts for an account', async () => {
            await Promise.all([
                fixtureManager.createPost(account),
                fixtureManager.createPost(account),
                fixtureManager.createPost(account),
            ]);

            const count = await postService.getOutboxItemCount(account.id);

            expect(count).toBe(3);
        });

        it('should return zero for account with no posts', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            const count = await postService.getOutboxItemCount(account.id);

            expect(count).toBe(0);
        });
    });

    describe('deleteByApId', () => {
        it('should delete a post successfully', async () => {
            const post = await fixtureManager.createPost(account);

            const result = await postService.deleteByApId(post.apId, account);

            expect(isError(result)).toBe(false);

            // Verify the post is marked as deleted in the database
            const savedPost = await postRepository.getById(post.id!);
            expect(savedPost).not.toBeNull();
            expect(Post.isDeleted(savedPost!)).toBe(true);

            // Verify deleted_at is set in the database
            const rowInDb = await db('posts')
                .where({ id: post.id })
                .select('deleted_at')
                .first();
            expect(rowInDb.deleted_at).not.toBeNull();
        });

        it('should return error when trying to delete a non existent post', async () => {
            vi.mocked(lookupObject).mockResolvedValue(null);

            const nonExistentPostUrl = new URL(
                'https://example.com/posts/nonexistent123',
            );

            const result = await postService.deleteByApId(
                nonExistentPostUrl,
                account,
            );

            if (!isError(result)) {
                throw new Error('Expected result to be an error');
            }

            expect(getError(result)).toBe('upstream-error');
        });

        it("should return error when trying to delete someone else's post", async () => {
            const [otherAccount] = await fixtureManager.createInternalAccount();
            const otherPost = await fixtureManager.createPost(otherAccount);

            const result = await postService.deleteByApId(
                otherPost.apId,
                account,
            );

            if (!isError(result)) {
                throw new Error('Expected result to be an error');
            }

            expect(getError(result)).toBe('not-author');

            // Verify the post is not deleted
            const savedPost = await postRepository.getById(otherPost.id!);
            expect(savedPost).not.toBeNull();
            expect(Post.isDeleted(savedPost!)).toBe(false);
        });

        it('should handle deleting an external post', async () => {
            const externalAccount =
                await fixtureManager.createExternalAccount();
            const externalPost =
                await fixtureManager.createPost(externalAccount);

            // Delete the external post
            const result = await postService.deleteByApId(
                externalPost.apId,
                externalAccount,
            );

            expect(isError(result)).toBe(false);

            const savedPost = await postRepository.getById(externalPost.id!);
            expect(savedPost).not.toBeNull();
            expect(Post.isDeleted(savedPost!)).toBe(true);

            // Verify deleted_at is set in the database
            const rowInDb = await db('posts')
                .where({ id: externalPost.id })
                .select('deleted_at')
                .first();
            expect(rowInDb.deleted_at).not.toBeNull();
        });

        it('should handle deleting a reply post', async () => {
            const originalPost = await fixtureManager.createPost(account);

            const result = await postService.createReply(
                account,
                'This is a reply to delete',
                originalPost.apId,
            );

            if (isError(result)) {
                throw new Error('Reply creation should not be an error');
            }

            const reply = getValue(result);

            // Delete the reply
            const deleteResult = await postService.deleteByApId(
                reply.apId,
                account,
            );

            if (isError(deleteResult)) {
                throw new Error('Delete result should not be an error');
            }

            const success = getValue(deleteResult);
            expect(success).toBe(true);

            const savedReply = await postRepository.getById(reply.id!);
            expect(savedReply).not.toBeNull();
            expect(Post.isDeleted(savedReply!)).toBe(true);

            // Verify deleted_at is set in the database
            const rowInDb = await db('posts')
                .where({ id: reply.id })
                .select('deleted_at')
                .first();
            expect(rowInDb.deleted_at).not.toBeNull();
        });
    });
});
