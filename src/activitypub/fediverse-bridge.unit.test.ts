import { beforeEach, describe, expect, it, vi } from 'vitest';

import EventEmitter from 'node:events';
import { Follow, Reject } from '@fedify/fedify';

import { AccountBlockedEvent } from 'account/account-blocked.event';
import { AccountEntity } from 'account/account.entity';
import type { AccountService } from 'account/account.service';
import { PostCreatedEvent } from 'post/post-created.event';
import { PostDeletedEvent } from 'post/post-deleted.event';
import { Post } from 'post/post.entity';
import { PostType } from 'post/post.entity';
import type { FedifyContext } from '../app';
import type { FedifyContextFactory } from './fedify-context.factory';
import { FediverseBridge } from './fediverse-bridge';

const nextTick = () => new Promise((resolve) => process.nextTick(resolve));

describe('FediverseBridge', () => {
    let events: EventEmitter;
    let accountService: AccountService;
    let context: FedifyContext;
    let fedifyContextFactory: FedifyContextFactory;

    beforeEach(() => {
        events = new EventEmitter();
        accountService = {
            getAccountById: vi.fn(),
        } as unknown as AccountService;
        context = {
            getObjectUri() {
                return new URL('https://mockdeleteurl.com');
            },
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
    });

    it('Sends delete activities on the PostDeletedEvent', async () => {
        const bridge = new FediverseBridge(
            events,
            fedifyContextFactory,
            accountService,
        );

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
        const bridge = new FediverseBridge(
            events,
            fedifyContextFactory,
            accountService,
        );

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

        // Assert that the activity was sent from the correct account
        expect(sendActivityMockCall![0]).toMatchObject({
            username: blockerAccount.username,
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
        const bridge = new FediverseBridge(
            events,
            fedifyContextFactory,
            accountService,
        );
        await bridge.init();

        const sendActivity = vi.spyOn(context, 'sendActivity');
        const globalDbSet = vi.spyOn(context.data.globaldb, 'set');

        const author = Object.create(AccountEntity);
        author.id = 123;
        author.username = 'testuser';
        author.apId = new URL('https://author.com/user/123');
        author.isInternal = true;
        author.apFollowers = new URL('https://author.com/user/123/followers');

        const post = Object.create(Post);
        post.id = 'post-123';
        post.author = author;
        post.type = PostType.Note;
        post.content = 'Test note content';
        post.apId = new URL('https://author.com/post/123');

        const event = new PostCreatedEvent(post);
        events.emit(PostCreatedEvent.getName(), event);

        await nextTick();

        expect(sendActivity).toHaveBeenCalledOnce();
        expect(context.data.globaldb.set).toHaveBeenCalled();
        expect(context.data.db.get).toHaveBeenCalledWith(['outbox']);
        expect(context.data.db.set).toHaveBeenCalledWith(
            ['outbox'],
            expect.any(Array),
        );

        const storedActivity = await globalDbSet.mock.calls[0][1];
        expect(storedActivity).toMatchObject({
            '@context': expect.any(Array),
            type: 'Create',
            actor: author.apId.href,
            object: {
                type: 'Note',
                content: post.content,
                attributedTo: author.apId.href,
            },
        });
    });

    it('should create and send an Article activity for internal accounts on the PostCreatedEvent', async () => {
        const bridge = new FediverseBridge(
            events,
            fedifyContextFactory,
            accountService,
        );
        await bridge.init();

        const sendActivity = vi.spyOn(context, 'sendActivity');
        const globalDbSet = vi.spyOn(context.data.globaldb, 'set');

        const author = Object.create(AccountEntity);
        author.id = 123;
        author.username = 'testuser';
        author.apId = new URL('https://author.com/user/123');
        author.isInternal = true;
        author.apFollowers = new URL('https://author.com/user/123/followers');

        const post = Object.create(Post);
        post.id = 'post-123';
        post.author = author;
        post.type = PostType.Article;
        post.title = 'Test Article';
        post.content = 'Test article content';
        post.excerpt = 'Test excerpt';
        post.imageUrl = new URL('https://example.com/image.jpg');
        post.publishedAt = new Date('2024-01-01T00:00:00Z');
        post.url = new URL('https://example.com/post/123');

        const event = new PostCreatedEvent(post);
        events.emit(PostCreatedEvent.getName(), event);

        await nextTick();

        expect(sendActivity).toHaveBeenCalledOnce();
        expect(context.data.globaldb.set).toHaveBeenCalled();
        expect(context.data.db.get).toHaveBeenCalledWith(['outbox']);
        expect(context.data.db.set).toHaveBeenCalledWith(
            ['outbox'],
            expect.any(Array),
        );

        const storedActivity = await globalDbSet.mock.calls[0][1];
        expect(storedActivity).toMatchObject({
            '@context': expect.any(Array),
            type: 'Create',
            actor: author.apId.href,
            object: {
                type: 'Article',
                name: post.title,
                content: post.content,
                image: post.imageUrl.href,
                url: post.url.href,
                preview: {
                    type: 'Note',
                    content: post.excerpt,
                },
            },
        });
    });

    it('should not create or send activities for external accounts on the PostCreatedEvent', async () => {
        const bridge = new FediverseBridge(
            events,
            fedifyContextFactory,
            accountService,
        );
        await bridge.init();

        const sendActivity = vi.spyOn(context, 'sendActivity');

        const author = Object.create(AccountEntity);
        author.id = 123;
        author.username = 'testuser';
        author.apId = new URL('https://author.com/user/123');
        author.isInternal = false;

        const post = Object.create(Post);
        post.author = author;
        post.type = PostType.Note;
        post.content = 'Test content';

        const event = new PostCreatedEvent(post);
        events.emit(PostCreatedEvent.getName(), event);

        await nextTick();

        expect(sendActivity).not.toHaveBeenCalled();
        expect(context.data.globaldb.set).not.toHaveBeenCalled();
    });
});
