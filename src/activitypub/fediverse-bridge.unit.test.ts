import { beforeEach, describe, expect, it, vi } from 'vitest';

import EventEmitter from 'node:events';

import { type Object as FedifyObject, Follow, Reject } from '@fedify/fedify';

import { AccountEntity } from '@/account/account.entity';
import type { AccountService } from '@/account/account.service';
import { AccountBlockedEvent, AccountUpdatedEvent } from '@/account/events';
import type { FedifyContextFactory } from '@/activitypub/fedify-context.factory';
import { FediverseBridge } from '@/activitypub/fediverse-bridge';
import type { UriBuilder } from '@/activitypub/uri';
import type { FedifyContext } from '@/app';
import { Post, PostType } from '@/post/post.entity';
import type { KnexPostRepository } from '@/post/post.repository.knex';
import { PostCreatedEvent } from '@/post/post-created.event';
import { PostDeletedEvent } from '@/post/post-deleted.event';
import { PostUpdatedEvent } from '@/post/post-updated.event';

const nextTick = () => new Promise((resolve) => process.nextTick(resolve));

vi.mock('node:crypto', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:crypto')>();
    return {
        ...actual,
        randomUUID: vi.fn(() => 'cb1e7e92-5560-4ceb-9272-7e9d0e2a7da4'),
    };
});

describe('FediverseBridge', () => {
    let events: EventEmitter;
    let accountService: AccountService;
    let postRepository: KnexPostRepository;
    let context: FedifyContext;
    let fedifyContextFactory: FedifyContextFactory;
    let mockUriBuilder: UriBuilder<FedifyObject>;
    let bridge: FediverseBridge;

    beforeEach(() => {
        events = new EventEmitter();
        accountService = {
            getAccountById: vi.fn(),
        } as unknown as AccountService;
        postRepository = {
            getById: vi.fn(),
        } as unknown as KnexPostRepository;
        mockUriBuilder = {
            buildObjectUri: vi.fn().mockImplementation((object, { id }) => {
                return new URL(
                    `https://example.com/${object.name.toLowerCase()}/${id}`,
                );
            }),
            buildFollowersCollectionUri: vi
                .fn()
                .mockImplementation((handle) => {
                    return new URL(
                        `https://example.com/user/${handle}/followers`,
                    );
                }),
        } as UriBuilder<FedifyObject>;
        context = {
            getObjectUri: mockUriBuilder.buildObjectUri,
            async sendActivity() {},
            data: {
                globaldb: {
                    set: vi.fn(),
                },
                db: {
                    get: vi.fn().mockResolvedValue([]),
                    set: vi.fn().mockResolvedValue(undefined),
                },
            },
        } as unknown as FedifyContext;
        fedifyContextFactory = {
            getFedifyContext() {
                return context;
            },
        } as FedifyContextFactory;
        bridge = new FediverseBridge(
            events,
            fedifyContextFactory,
            accountService,
            postRepository,
        );
    });

    it('Sends delete activities on the PostDeletedEvent', async () => {
        await bridge.init();

        const sendActivity = vi.spyOn(context, 'sendActivity');

        const author = Object.create(AccountEntity);
        author.id = 123;
        author.username = 'index';
        author.apId = new URL('https://author.com/user/123');
        author.isInternal = true;

        const post = Object.create(Post);
        post.author = author;
        post.apId = new URL('https://author.com/post/123');

        const event = new PostDeletedEvent(post, author.id);
        events.emit(PostDeletedEvent.getName(), event);

        await nextTick();

        expect(sendActivity.mock.lastCall).toBeDefined();

        expect(context.data.globaldb.set).toHaveBeenCalledOnce();
    });

    it('Does not send delete activities on the PostDeletedEvent for external accounts', async () => {
        await bridge.init();

        const sendActivity = vi.spyOn(context, 'sendActivity');

        const author = Object.create(AccountEntity);
        author.id = 123;
        author.username = 'index';
        author.apId = new URL('https://author.com/user/123');
        author.isInternal = false;

        const post = Object.create(Post);
        post.author = author;
        post.apId = new URL('https://author.com/post/123');

        const event = new PostDeletedEvent(post, author.id);
        events.emit(PostDeletedEvent.getName(), event);

        await nextTick();

        expect(sendActivity.mock.lastCall).not.toBeDefined();

        expect(context.data.globaldb.set).not.toHaveBeenCalledOnce();
    });

    it('Sends reject activity to blocked account on the AccountBlockedEvent', async () => {
        // Setup account repository
        const blockerAccount = {
            id: 123,
            username: 'blocker',
            apId: new URL('https://blocker.com/user/123'),
            apInbox: new URL('https://blocker.com/inbox'),
            isInternal: false,
        } as AccountEntity;

        const blockedAccount = {
            id: 456,
            username: 'blocked',
            apId: new URL('https://blocked.com/user/456'),
            apInbox: new URL('https://blocked.com/inbox'),
            isInternal: false,
        } as AccountEntity;

        vi.mocked(accountService.getAccountById).mockImplementation((id) => {
            if (id === blockerAccount.id) {
                return Promise.resolve(blockerAccount);
            }

            if (id === blockedAccount.id) {
                return Promise.resolve(blockedAccount);
            }

            return Promise.resolve(null);
        });

        // Initialize bridge and emit event
        const bridge = new FediverseBridge(
            events,
            fedifyContextFactory,
            accountService,
            postRepository,
        );
        await bridge.init();

        const sendActivity = vi.spyOn(context, 'sendActivity');

        const event = new AccountBlockedEvent(
            blockedAccount.id,
            blockerAccount.id,
        );

        events.emit(AccountBlockedEvent.getName(), event);

        // Wait for the event to be processed
        await nextTick();

        // Assert that the activity was sent with the correct parameters
        const sendActivityMockCall = sendActivity.mock.lastCall;
        expect(sendActivityMockCall).toBeDefined();
        expect(sendActivityMockCall!.length).toBe(3);

        expect(sendActivityMockCall![0]).toMatchObject({
            username: 'blocker',
        });

        // Assert that the activity was sent to the correct account
        expect(sendActivityMockCall![1]).toMatchObject({
            id: blockedAccount.apId,
            inboxId: blockedAccount.apInbox,
        });

        // Assert that the activity is a rejection of a follow activity
        expect(sendActivityMockCall![2]).toBeInstanceOf(Reject);
        expect(sendActivityMockCall![2].actorId).toBe(blockerAccount.apId);

        const rejectedFollow = await sendActivityMockCall![2].getObject();
        expect(rejectedFollow).toBeInstanceOf(Follow);

        const followJsonLd = (await rejectedFollow!.toJsonLd()) as {
            actor: string;
            object: string;
        };
        expect(followJsonLd.actor).toBe(blockedAccount.apId.toString());
        expect(followJsonLd.object).toBe(blockerAccount.apId.toString());

        // Assert that the activity was saved to the database
        expect(context.data.globaldb.set).toHaveBeenCalledOnce();
    });

    it('Does not send a reject activity to blocked account on the AccountBlockedEvent if the blocked account is internal', async () => {
        // Setup account repository
        const blockerAccount = {
            id: 123,
            username: 'blocker',
            apId: new URL('https://blocker.com/user/123'),
            apInbox: new URL('https://blocker.com/inbox'),
            isInternal: true,
        } as AccountEntity;

        const blockedAccount = {
            id: 456,
            username: 'blocked',
            apId: new URL('https://blocked.com/user/456'),
            apInbox: new URL('https://blocked.com/inbox'),
            isInternal: true,
        } as AccountEntity;

        vi.mocked(accountService.getAccountById).mockImplementation((id) => {
            if (id === blockerAccount.id) {
                return Promise.resolve(blockerAccount);
            }

            if (id === blockedAccount.id) {
                return Promise.resolve(blockedAccount);
            }

            return Promise.resolve(null);
        });

        // Initialize bridge and emit event
        const bridge = new FediverseBridge(
            events,
            fedifyContextFactory,
            accountService,
            postRepository,
        );
        await bridge.init();

        const sendActivity = vi.spyOn(context, 'sendActivity');

        const event = new AccountBlockedEvent(
            blockedAccount.id,
            blockerAccount.id,
        );

        events.emit(AccountBlockedEvent.getName(), event);

        // Wait for the event to be processed
        await nextTick();

        // Assert that the activity was not sent
        expect(sendActivity.mock.lastCall).not.toBeDefined();

        // Assert that the activity was not saved to the database
        expect(context.data.globaldb.set).not.toHaveBeenCalled();
    });

    it('Does not send a reject activity to blocked account on the AccountBlockedEvent if the blocker account cannot be found', async () => {
        // Setup account repository
        const blockedAccount = {
            id: 987,
            username: 'blocked',
            apId: new URL('https://blocked.com/user/987'),
            apInbox: new URL('https://blocked.com/inbox'),
            isInternal: true,
        } as AccountEntity;

        vi.mocked(accountService.getAccountById).mockImplementation((id) => {
            if (id === blockedAccount.id) {
                return Promise.resolve(blockedAccount);
            }

            return Promise.resolve(null);
        });

        // Initialize bridge and emit event
        const bridge = new FediverseBridge(
            events,
            fedifyContextFactory,
            accountService,
            postRepository,
        );
        await bridge.init();

        const sendActivity = vi.spyOn(context, 'sendActivity');

        const event = new AccountBlockedEvent(blockedAccount.id, 123);

        events.emit(AccountBlockedEvent.getName(), event);

        // Wait for the event to be processed
        await nextTick();

        // Assert that the activity was not sent
        expect(sendActivity.mock.lastCall).not.toBeDefined();

        // Assert that the activity was not saved to the database
        expect(context.data.globaldb.set).not.toHaveBeenCalled();
    });

    it('Does not send a reject activity to blocked account on the AccountBlockedEvent if the blocked account cannot be found', async () => {
        // Setup account repository
        const blockerAccount = {
            id: 123,
            username: 'blocker',
            apId: new URL('https://blocker.com/user/123'),
            apInbox: new URL('https://blocker.com/inbox'),
            isInternal: true,
        } as AccountEntity;

        vi.mocked(accountService.getAccountById).mockImplementation((id) => {
            if (id === blockerAccount.id) {
                return Promise.resolve(blockerAccount);
            }

            return Promise.resolve(null);
        });

        // Initialize bridge and emit event
        const bridge = new FediverseBridge(
            events,
            fedifyContextFactory,
            accountService,
            postRepository,
        );
        await bridge.init();

        const sendActivity = vi.spyOn(context, 'sendActivity');

        const event = new AccountBlockedEvent(987, blockerAccount.id);

        events.emit(AccountBlockedEvent.getName(), event);

        // Wait for the event to be processed
        await nextTick();

        // Assert that the activity was not sent
        expect(sendActivity.mock.lastCall).not.toBeDefined();

        // Assert that the activity was not saved to the database
        expect(context.data.globaldb.set).not.toHaveBeenCalled();
    });

    it('should create and send a Note activity for internal accounts on the PostCreatedEvent', async () => {
        await bridge.init();

        const sendActivity = vi.spyOn(context, 'sendActivity');
        const globalDbSet = vi.spyOn(context.data.globaldb, 'set');

        const author = Object.create(AccountEntity);
        author.id = 123;
        author.username = 'testuser';
        author.apId = new URL('https://example.com/user/foo');
        author.isInternal = true;
        author.apFollowers = new URL('https://example.com/user/foo/followers');

        const post = Object.create(Post);
        post.id = 456;
        post.author = author;
        post.type = PostType.Note;
        post.content = 'Note content';
        post.apId = new URL('https://example.com/note/post-123');
        post.mentions = [];
        post.uuid = 'cb1e7e92-5560-4ceb-9272-7e9d0e2a7da4';
        post.publishedAt = new Date('2025-01-01T00:00:00Z');

        vi.mocked(postRepository.getById).mockResolvedValue(post);

        const event = new PostCreatedEvent(post.id as number);
        events.emit(PostCreatedEvent.getName(), event);

        await nextTick();

        expect(postRepository.getById).toHaveBeenCalledWith(post.id);
        expect(sendActivity).toHaveBeenCalledOnce();
        expect(context.data.globaldb.set).toHaveBeenCalled();

        const storedActivity = await globalDbSet.mock.calls[0][1];
        await expect(storedActivity).toMatchFileSnapshot(
            './__snapshots__/publish-note-create-activity.json',
        );
    });

    it('should include mentions in the Note activity for internal accounts on the PostCreatedEvent', async () => {
        await bridge.init();
        const globalDbSet = vi.spyOn(context.data.globaldb, 'set');

        const author = Object.create(AccountEntity);
        author.id = 123;
        author.username = 'testuser';
        author.apId = new URL('https://example.com/user/foo');
        author.isInternal = true;
        author.apFollowers = new URL('https://example.com/user/foo/followers');

        const mentionedAccount = Object.create(AccountEntity);
        mentionedAccount.id = 456;
        mentionedAccount.username = 'test';
        mentionedAccount.apId = new URL('https://example.com/@test');
        mentionedAccount.isInternal = true;

        const post = Object.create(Post);
        post.id = 789;
        post.author = author;
        post.type = PostType.Note;
        post.content = 'Hello! @test@example.com';
        post.apId = new URL('https://example.com/note/post-123');
        post.mentions = [mentionedAccount];
        post.uuid = 'cb1e7e92-5560-4ceb-9272-7e9d0e2a7da4';
        post.publishedAt = new Date('2025-01-01T00:00:00Z');

        vi.mocked(postRepository.getById).mockResolvedValue(post);

        const event = new PostCreatedEvent(post.id as number);
        events.emit(PostCreatedEvent.getName(), event);

        await nextTick();

        expect(postRepository.getById).toHaveBeenCalledWith(post.id);

        const storedActivity = await globalDbSet.mock.calls[0][1];
        await expect(storedActivity).toMatchFileSnapshot(
            './__snapshots__/publish-note-create-activity-with-mentions.json',
        );
    });

    it('should create and send an Article activity for internal accounts on the PostCreatedEvent', async () => {
        await bridge.init();

        const sendActivity = vi.spyOn(context, 'sendActivity');
        const globalDbSet = vi.spyOn(context.data.globaldb, 'set');

        const author = Object.create(AccountEntity);
        author.id = 123;
        author.username = 'testuser';
        author.apId = new URL('https://example.com/user/foo');
        author.isInternal = true;
        author.apFollowers = new URL('https://example.com/user/foo/followers');

        const post = Object.create(Post);
        post.id = 456;
        post.author = author;
        post.type = PostType.Article;
        post.title = 'Post title';
        post.content = 'Post content';
        post.excerpt = 'Post excerpt';
        post.imageUrl = new URL('https://example.com/img/456_feature.jpg');
        post.publishedAt = new Date('2025-01-12T10:30:00Z');
        post.url = new URL('https://example.com/post/456');
        post.apId = new URL('https://example.com/article/456');
        post.uuid = 'cb1e7e92-5560-4ceb-9272-7e9d0e2a7da4';

        vi.mocked(postRepository.getById).mockResolvedValue(post);

        const event = new PostCreatedEvent(post.id as number);
        events.emit(PostCreatedEvent.getName(), event);

        await nextTick();

        expect(postRepository.getById).toHaveBeenCalledWith(post.id);
        expect(sendActivity).toHaveBeenCalledOnce();
        expect(context.data.globaldb.set).toHaveBeenCalled();

        const storedActivity = await globalDbSet.mock.calls[0][1];
        await expect(storedActivity).toMatchFileSnapshot(
            './__snapshots__/publish-post-create-activity.json',
        );
    });

    it('should not create or send activities for external accounts on the PostCreatedEvent', async () => {
        await bridge.init();

        const sendActivity = vi.spyOn(context, 'sendActivity');

        const author = Object.create(AccountEntity);
        author.id = 123;
        author.username = 'testuser';
        author.apId = new URL('https://author.com/user/123');
        author.isInternal = false;

        const post = Object.create(Post);
        post.id = 456;
        post.author = author;
        post.type = PostType.Note;
        post.content = 'Test content';

        vi.mocked(postRepository.getById).mockResolvedValue(post);

        const event = new PostCreatedEvent(post.id as number);
        events.emit(PostCreatedEvent.getName(), event);

        await nextTick();

        expect(postRepository.getById).toHaveBeenCalledWith(post.id);
        expect(sendActivity).not.toHaveBeenCalled();
        expect(context.data.globaldb.set).not.toHaveBeenCalled();
    });

    it('should not create or send activities if post is not found on the PostCreatedEvent', async () => {
        await bridge.init();

        const sendActivity = vi.spyOn(context, 'sendActivity');

        vi.mocked(postRepository.getById).mockResolvedValue(null);

        const event = new PostCreatedEvent(123);
        events.emit(PostCreatedEvent.getName(), event);

        await nextTick();

        expect(postRepository.getById).toHaveBeenCalledWith(123);
        expect(sendActivity).not.toHaveBeenCalled();
        expect(context.data.globaldb.set).not.toHaveBeenCalled();
    });

    it('should send update activities on the PostUpdatedEvent for internal accounts', async () => {
        await bridge.init();

        const sendActivity = vi.spyOn(context, 'sendActivity');
        const globalDbSet = vi.spyOn(context.data.globaldb, 'set');

        const author = Object.create(AccountEntity);
        author.id = 123;
        author.username = 'testuser';
        author.apId = new URL('https://example.com/user/foo');
        author.isInternal = true;
        author.apFollowers = new URL('https://example.com/user/foo/followers');

        const post = Object.create(Post);
        post.id = 456;
        post.uuid = 'cb1e7e92-5560-4ceb-9272-7e9d0e2a7da4';
        post.author = author;
        post.type = PostType.Article;
        post.title = 'Updated Post Title';
        post.content = 'Updated post content';
        post.apId = new URL('https://example.com/article/post-456');
        post.publishedAt = new Date('2025-01-01T00:00:00Z');

        vi.mocked(postRepository.getById).mockResolvedValue(post);

        const event = new PostUpdatedEvent(456);
        events.emit(PostUpdatedEvent.getName(), event);

        await nextTick();
        expect(postRepository.getById).toHaveBeenCalledWith(456);
        expect(sendActivity).toHaveBeenCalledOnce();
        expect(context.data.globaldb.set).toHaveBeenCalledTimes(2);

        const storedActivity = await globalDbSet.mock.calls[0][1];
        await expect(storedActivity).toMatchFileSnapshot(
            './__snapshots__/publish-post-update-activity.json',
        );
    });

    it('should not send update activities on the PostUpdatedEvent for external accounts', async () => {
        await bridge.init();

        const sendActivity = vi.spyOn(context, 'sendActivity');

        const author = Object.create(AccountEntity);
        author.id = 123;
        author.username = 'testuser';
        author.apId = new URL('https://external.com/user/foo');
        author.isInternal = false;

        const post = Object.create(Post);
        post.id = 456;
        post.author = author;
        post.type = PostType.Article;
        post.title = 'Updated Post Title';
        post.content = 'Updated post content';
        post.apId = new URL('https://external.com/article/post-456');

        vi.mocked(postRepository.getById).mockResolvedValue(post);

        const event = new PostUpdatedEvent(456);
        events.emit(PostUpdatedEvent.getName(), event);

        await nextTick();
        expect(postRepository.getById).toHaveBeenCalledWith(456);
        expect(sendActivity).not.toHaveBeenCalled();
        expect(context.data.globaldb.set).not.toHaveBeenCalled();
    });

    it('should not send update activities on the PostUpdatedEvent if post is not found', async () => {
        await bridge.init();

        const sendActivity = vi.spyOn(context, 'sendActivity');

        vi.mocked(postRepository.getById).mockResolvedValue(null);

        const event = new PostUpdatedEvent(999);
        events.emit(PostUpdatedEvent.getName(), event);

        await nextTick();
        expect(postRepository.getById).toHaveBeenCalledWith(999);
        expect(sendActivity).not.toHaveBeenCalled();
        expect(context.data.globaldb.set).not.toHaveBeenCalled();
    });

    it('should send update activity on AccountUpdatedEvent for internal accounts', async () => {
        const internalAccount = {
            id: 123,
            username: 'testuser',
            apId: new URL('https://example.com/user/123'),
            apFollowers: new URL('https://example.com/user/123/followers'),
            isInternal: true,
        } as AccountEntity;

        vi.mocked(accountService.getAccountById).mockResolvedValue(
            internalAccount,
        );

        await bridge.init();

        const sendActivity = vi.spyOn(context, 'sendActivity');

        const event = new AccountUpdatedEvent(internalAccount.id);
        events.emit(AccountUpdatedEvent.getName(), event);

        await nextTick();

        expect(accountService.getAccountById).toHaveBeenCalledWith(
            internalAccount.id,
        );
        expect(sendActivity).toHaveBeenCalledOnce();
        expect(context.data.globaldb.set).toHaveBeenCalledOnce();
    });

    it('should not send update activity on AccountUpdatedEvent for external accounts', async () => {
        const externalAccount = {
            id: 456,
            username: 'external',
            apId: new URL('https://external.com/user/456'),
            apFollowers: new URL('https://external.com/user/456/followers'),
            isInternal: false,
        } as AccountEntity;

        vi.mocked(accountService.getAccountById).mockResolvedValue(
            externalAccount,
        );

        await bridge.init();

        const sendActivity = vi.spyOn(context, 'sendActivity');

        const event = new AccountUpdatedEvent(externalAccount.id);
        events.emit(AccountUpdatedEvent.getName(), event);

        await nextTick();

        expect(accountService.getAccountById).toHaveBeenCalledWith(
            externalAccount.id,
        );
        expect(sendActivity).not.toHaveBeenCalled();
        expect(context.data.globaldb.set).not.toHaveBeenCalled();
    });

    it('should not send update activity on AccountUpdatedEvent if account is not found', async () => {
        vi.mocked(accountService.getAccountById).mockResolvedValue(null);

        await bridge.init();

        const sendActivity = vi.spyOn(context, 'sendActivity');

        const event = new AccountUpdatedEvent(999);
        events.emit(AccountUpdatedEvent.getName(), event);

        await nextTick();

        expect(accountService.getAccountById).toHaveBeenCalledWith(999);
        expect(sendActivity).not.toHaveBeenCalled();
        expect(context.data.globaldb.set).not.toHaveBeenCalled();
    });
});
