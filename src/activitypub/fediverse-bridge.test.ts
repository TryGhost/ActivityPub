import EventEmitter from 'node:events';
import type { Account } from 'account/types';
import { describe, expect, it, vi } from 'vitest';
import type { FedifyRequestContext } from '../app';
import type { FedifyContextFactory } from './fedify-context.factory';
import { FediverseBridge } from './fediverse-bridge';

const nextTick = () => new Promise((resolve) => process.nextTick(resolve));

describe('FediverseBridge', () => {
    it('Sends update activities on the account.updated event', async () => {
        const events = new EventEmitter();
        const context: FedifyRequestContext = {
            getObjectUri() {
                return new URL('https://mockupdateurl.com');
            },
            async sendActivity() {},
            data: {
                globaldb: {
                    set: vi.fn(),
                },
            },
        } as unknown as FedifyRequestContext;
        const fedifyContextFactory = {
            getFedifyContext() {
                return context;
            },
        } as FedifyContextFactory;

        const bridge = new FediverseBridge(events, fedifyContextFactory);

        await bridge.init();

        const sendActivity = vi.spyOn(context, 'sendActivity');

        const account: Account = {
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
});
