import EventEmitter from 'node:events';
import { Account } from 'account/account.entity';
import type { Account as AccountType } from 'account/types';
import { PostDeletedEvent } from 'post/post-deleted.event';
import { Post } from 'post/post.entity';
import { describe, expect, it, vi } from 'vitest';
import type { FedifyContext } from '../app';
import type { FedifyContextFactory } from './fedify-context.factory';
import { FediverseBridge } from './fediverse-bridge';

const nextTick = () => new Promise((resolve) => process.nextTick(resolve));

describe('FediverseBridge', () => {
    it('Sends update activities on the account.updated event', async () => {
        const events = new EventEmitter();
        const context: FedifyContext = {
            getObjectUri() {
                return new URL('https://mockupdateurl.com');
            },
            async sendActivity() {},
            data: {
                globaldb: {
                    set: vi.fn(),
                },
            },
        } as unknown as FedifyContext;
        const fedifyContextFactory = {
            getFedifyContext() {
                return context;
            },
        } as FedifyContextFactory;

        const bridge = new FediverseBridge(events, fedifyContextFactory);

        await bridge.init();

        const sendActivity = vi.spyOn(context, 'sendActivity');

        const account: AccountType = {
            id: 1,
            username: 'username',
            name: 'Name',
            bio: 'Bio',
            avatar_url: '',
            banner_image_url: '',
            url: 'https://account.com',
            custom_fields: null,
            ap_id: 'https://account.com',
            ap_inbox_url: 'https://account.com/inbox',
            ap_shared_inbox_url: 'https://account.com/inbox',
            ap_outbox_url: 'https://account.com/outbox',
            ap_following_url: 'https://account.com/following',
            ap_followers_url: 'https://account.com/followers',
            ap_liked_url: 'https://account.com/liked',
            ap_public_key: '{}',
            ap_private_key: '{}',
        };

        events.emit('account.updated', account);

        await nextTick();

        expect(sendActivity.mock.lastCall).toBeDefined();

        expect(context.data.globaldb.set).toHaveBeenCalledOnce();
    });

    it('Sends delete activities on the PostDeletedEvent', async () => {
        const events = new EventEmitter();
        const context: FedifyContext = {
            getObjectUri() {
                return new URL('https://mockdeleteurl.com');
            },
            async sendActivity() {},
            data: {
                globaldb: {
                    set: vi.fn(),
                },
            },
        } as unknown as FedifyContext;
        const fedifyContextFactory = {
            getFedifyContext() {
                return context;
            },
        } as FedifyContextFactory;

        const bridge = new FediverseBridge(events, fedifyContextFactory);

        await bridge.init();

        const sendActivity = vi.spyOn(context, 'sendActivity');

        const author = Object.create(Account);
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
        const events = new EventEmitter();
        const context: FedifyContext = {
            getObjectUri() {
                return new URL('https://mockeddeleteurl.com');
            },
            async sendActivity() {},
            data: {
                globaldb: {
                    set: vi.fn(),
                },
            },
        } as unknown as FedifyContext;
        const fedifyContextFactory = {
            getFedifyContext() {
                return context;
            },
        } as FedifyContextFactory;

        const bridge = new FediverseBridge(events, fedifyContextFactory);

        await bridge.init();

        const sendActivity = vi.spyOn(context, 'sendActivity');

        const author = Object.create(Account);
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
});
