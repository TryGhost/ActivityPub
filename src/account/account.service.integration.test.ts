import { beforeEach, describe, expect, it } from 'vitest';

import {
    ACTOR_DEFAULT_ICON,
    ACTOR_DEFAULT_NAME,
    ACTOR_DEFAULT_SUMMARY,
    AP_BASE_PATH,
    TABLE_ACCOUNTS,
    TABLE_FOLLOWS,
    TABLE_SITES,
    TABLE_USERS,
} from '../constants';
import { client as db } from '../db';

import { AccountService } from './account.service';
import type { ExternalAccountData, Site } from './types';

describe('AccountService', () => {
    let service: AccountService;
    let site: Site;

    beforeEach(async () => {
        // Clean up the database
        await db.raw('SET FOREIGN_KEY_CHECKS = 0');
        await db(TABLE_FOLLOWS).truncate();
        await db(TABLE_ACCOUNTS).truncate();
        await db(TABLE_USERS).truncate();
        await db(TABLE_SITES).truncate();
        await db.raw('SET FOREIGN_KEY_CHECKS = 1');

        // Insert a site
        const siteData = {
            host: 'example.com',
            webhook_secret: 'secret',
        };
        const [id] = await db('sites').insert(siteData);

        site = {
            id,
            ...siteData,
        };

        // Create the service
        service = new AccountService(db);
    });

    it(
        'should create an internal account',
        async () => {
            const username = 'foobarbaz';

            const expectedAccount = {
                name: ACTOR_DEFAULT_NAME,
                username,
                bio: ACTOR_DEFAULT_SUMMARY,
                avatar_url: ACTOR_DEFAULT_ICON,
                url: `https://${site.host}`,
                custom_fields: null,
                ap_id: `https://${site.host}${AP_BASE_PATH}/users/${username}`,
                ap_inbox_url: `https://${site.host}${AP_BASE_PATH}/inbox/${username}`,
                ap_outbox_url: `https://${site.host}${AP_BASE_PATH}/outbox/${username}`,
                ap_following_url: `https://${site.host}${AP_BASE_PATH}/following/${username}`,
                ap_followers_url: `https://${site.host}${AP_BASE_PATH}/followers/${username}`,
                ap_liked_url: `https://${site.host}${AP_BASE_PATH}/liked/${username}`,
                ap_shared_inbox_url: null,
            };

            const account = await service.createInternalAccount(site, username);

            // Assert the created account was returned
            expect(account).toMatchObject(expectedAccount);
            expect(account.id).toBeGreaterThan(0);
            expect(account.ap_public_key).toBeDefined();
            expect(account.ap_public_key).toContain('key_ops');
            expect(account.ap_private_key).toBeDefined();
            expect(account.ap_private_key).toContain('key_ops');

            // Assert the account was inserted into the database
            const accounts = await db(TABLE_ACCOUNTS).select('*');

            expect(accounts).toHaveLength(1);

            const dbAccount = accounts[0];

            expect(dbAccount).toMatchObject(expectedAccount);

            // Assert the user was inserted into the database
            const users = await db(TABLE_USERS).select('*');

            expect(users).toHaveLength(1);

            const dbUser = users[0];

            expect(dbUser.account_id).toBe(account.id);
            expect(dbUser.site_id).toBe(site.id);
        },
        1000 * 10, // Increase timeout to 10 seconds as 5 seconds seems to be too short on CI
    );

    it('should create an external account', async () => {
        const accountData: ExternalAccountData = {
            username: 'external-account',
            name: 'External Account',
            bio: 'External Account Bio',
            avatar_url: 'https://example.com/avatars/external-account.png',
            banner_image_url:
                'https://example.com/banners/external-account.png',
            url: 'https://example.com/users/external-account',
            custom_fields: {},
            ap_id: 'https://example.com/activitypub/users/external-account',
            ap_inbox_url:
                'https://example.com/activitypub/inbox/external-account',
            ap_outbox_url:
                'https://example.com/activitypub/outbox/external-account',
            ap_following_url:
                'https://example.com/activitypub/following/external-account',
            ap_followers_url:
                'https://example.com/activitypub/followers/external-account',
            ap_liked_url:
                'https://example.com/activitypub/liked/external-account',
            ap_shared_inbox_url: null,
            ap_public_key: '',
        };

        const account = await service.createExternalAccount(accountData);

        // Assert the created account was returned
        expect(account).toMatchObject(accountData);
        expect(account.id).toBeGreaterThan(0);

        // Assert the account was inserted into the database
        const accounts = await db(TABLE_ACCOUNTS).select('*');

        expect(accounts).toHaveLength(1);

        const dbAccount = accounts[0];

        expect(dbAccount).toMatchObject(accountData);
    });

    it('should record an account being followed', async () => {
        const account = await service.createInternalAccount(site, 'account');
        const follower = await service.createInternalAccount(site, 'follower');

        await service.recordAccountFollow(account, follower);

        // Assert the follow was inserted into the database
        const follows = await db(TABLE_FOLLOWS).select('*');

        expect(follows).toHaveLength(1);

        const follow = follows[0];

        expect(follow.following_id).toBe(account.id);
        expect(follow.follower_id).toBe(follower.id);
    });

    it('should not record duplicate follows', async () => {
        const account = await service.createInternalAccount(site, 'account');
        const follower = await service.createInternalAccount(site, 'follower');

        await service.recordAccountFollow(account, follower);

        const firstFollow = await db(TABLE_FOLLOWS).where({ id: 1 }).first();

        await service.recordAccountFollow(account, follower);

        // Assert the follow was inserted into the database only once
        const follows = await db(TABLE_FOLLOWS).select('*');

        expect(follows).toHaveLength(1);

        // Assert the data was not changed
        const follow = follows[0];

        expect(follow.following_id).toBe(firstFollow.following_id);
        expect(follow.follower_id).toBe(firstFollow.follower_id);
        expect(follow.created_at).toStrictEqual(firstFollow.created_at);
        expect(follow.updated_at).toStrictEqual(firstFollow.updated_at);
    });

    it('should retrieve an account by its ActivityPub ID', async () => {
        const account = await service.createInternalAccount(site, 'account');

        const retrievedAccount = await service.getAccountByApId(account.ap_id);

        expect(retrievedAccount).toMatchObject(account);
    });
});
