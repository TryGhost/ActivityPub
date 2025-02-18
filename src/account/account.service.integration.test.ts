import { beforeEach, describe, expect, it, vi } from 'vitest';

import EventEmitter from 'node:events';

import { FedifyContextFactory } from '../activitypub/fedify-context.factory';
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
import { KnexAccountRepository } from './account.repository.knex';
import { AccountService } from './account.service';
import type {
    Account,
    ExternalAccountData,
    InternalAccountData,
    Site,
} from './types';

vi.mock('@fedify/fedify', async () => {
    // generateCryptoKeyPair is a slow operation so we generate a key pair
    // upfront and re-use it for all tests
    const original = await vi.importActual('@fedify/fedify');

    // @ts-expect-error - generateCryptoKeyPair is not typed
    const keyPair = await original.generateCryptoKeyPair();

    return {
        ...original,
        generateCryptoKeyPair: vi.fn().mockReturnValue(keyPair),
    };
});

describe('AccountService', () => {
    let service: AccountService;
    let events: EventEmitter;
    let site: Site;
    let internalAccountData: InternalAccountData;
    let externalAccountData: ExternalAccountData;

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

        // Init reusable account data
        internalAccountData = {
            username: 'index',
            name: 'Test Site Title',
            bio: 'Test Site Description',
            avatar_url: 'Test Site Icon',
        };
        externalAccountData = {
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

        // Init dependencies
        events = new EventEmitter();
        const accountRepository = new KnexAccountRepository(db, events);
        const fedifyContextFactory = new FedifyContextFactory();

        // Create the service
        service = new AccountService(
            db,
            events,
            accountRepository,
            fedifyContextFactory,
        );
    });

    describe('createInternalAccount', () => {
        it('should create an internal account', async () => {
            const username = internalAccountData.username;

            const expectedAccount = {
                name: internalAccountData.name || ACTOR_DEFAULT_NAME,
                username: username,
                bio: internalAccountData.bio || ACTOR_DEFAULT_SUMMARY,
                avatar_url:
                    internalAccountData.avatar_url || ACTOR_DEFAULT_ICON,
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

            const account = await service.createInternalAccount(
                site,
                internalAccountData,
            );

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
        });
    });

    describe('createExternalAccount', () => {
        it('should create an external account', async () => {
            const account =
                await service.createExternalAccount(externalAccountData);

            // Assert the created account was returned
            expect(account).toMatchObject(externalAccountData);
            expect(account.id).toBeGreaterThan(0);

            // Assert the account was inserted into the database
            const accounts = await db(TABLE_ACCOUNTS).select('*');

            expect(accounts).toHaveLength(1);

            const dbAccount = accounts[0];

            expect(dbAccount).toMatchObject(externalAccountData);
        });
    });

    describe('recordAccountUnfollow', () => {
        it('should record an account being unfollowed', async () => {
            const account = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'account',
            });
            const follower = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'follower',
            });

            await service.recordAccountFollow(account, follower);

            // Assert the follow was inserted into the database
            const follows = await db(TABLE_FOLLOWS).select('*');

            expect(follows).toHaveLength(1);

            const follow = follows[0];

            expect(follow.following_id).toBe(account.id);
            expect(follow.follower_id).toBe(follower.id);

            await service.recordAccountUnfollow(account, follower);

            const followsAfter = await db(TABLE_FOLLOWS).select('*');

            expect(followsAfter).toHaveLength(0);
        });
    });

    describe('recordAccountFollow', () => {
        it('should record an account being followed', async () => {
            const account = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'account',
            });
            const follower = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'follower',
            });

            await service.recordAccountFollow(account, follower);

            // Assert the follow was inserted into the database
            const follows = await db(TABLE_FOLLOWS).select('*');

            expect(follows).toHaveLength(1);

            const follow = follows[0];

            expect(follow.following_id).toBe(account.id);
            expect(follow.follower_id).toBe(follower.id);
        });

        it('should not record duplicate follows', async () => {
            const account = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'account',
            });
            const follower = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'follower',
            });

            await service.recordAccountFollow(account, follower);

            const firstFollow = await db(TABLE_FOLLOWS)
                .where({ id: 1 })
                .first();

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
    });

    describe('getAccountByApId', () => {
        it('should retrieve an account by its ActivityPub ID', async () => {
            const account = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'account',
            });

            const retrievedAccount = await service.getAccountByApId(
                account.ap_id,
            );

            // Assert the retrieved account matches the created account
            expect(retrievedAccount).toMatchObject(account);
        });
    });

    describe('getDefaultAccountForSite', () => {
        it('should retrieve the default account for a site', async () => {
            const account = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'account',
            });

            const defaultAccount = await service.getDefaultAccountForSite(site);

            expect(defaultAccount).toMatchObject(account);
        });

        it('should throw an error if multiple users are found for a site', async () => {
            await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'account1',
            });
            await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'account2',
            });

            await expect(
                service.getDefaultAccountForSite(site),
            ).rejects.toThrow(`Multiple users found for site: ${site.id}`);
        });

        it('should throw an error if no users are found for a site', async () => {
            await expect(
                service.getDefaultAccountForSite(site),
            ).rejects.toThrow(`No user found for site: ${site.id}`);
        });

        it('should throw an error if no account is found for a site user', async () => {
            await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'account',
            });

            const rows = await db('users')
                .select('account_id')
                .where({ site_id: site.id });

            await db('accounts').where({ id: rows[0].account_id }).del();

            await expect(
                service.getDefaultAccountForSite(site),
            ).rejects.toThrow();
        });
    });

    describe('getFollowingAccounts', () => {
        it('should retrieve the accounts that an account follows', async () => {
            const account = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'account',
            });
            const following1 = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'following1',
            });
            const following2 = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'following2',
            });
            const following3 = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'following3',
            });

            await service.recordAccountFollow(following1, account);
            await service.recordAccountFollow(following2, account);
            await service.recordAccountFollow(following3, account);

            // Get a page of following accounts and assert the requested fields are returned
            const followingAccounts = await service.getFollowingAccounts(
                account,
                {
                    limit: 2,
                    offset: 0,
                    fields: ['id', 'username', 'ap_inbox_url'],
                },
            );

            expect(followingAccounts).toHaveLength(2);
            expect(followingAccounts[0]).toMatchObject({
                id: following3.id,
                username: following3.username,
            });
            expect(followingAccounts[0].ap_inbox_url).toBeDefined();

            expect(followingAccounts[1]).toMatchObject({
                id: following2.id,
                username: following2.username,
            });
            expect(followingAccounts[1].ap_inbox_url).toBeDefined();

            // Get the next page of following accounts and assert the requested fields are returned
            const nextFollowingAccounts = await service.getFollowingAccounts(
                account,
                {
                    limit: 2,
                    offset: 2,
                    fields: ['id', 'username', 'ap_inbox_url'],
                },
            );

            expect(nextFollowingAccounts).toHaveLength(1);
            expect(nextFollowingAccounts[0]).toMatchObject({
                id: following1.id,
                username: following1.username,
            });
            expect(nextFollowingAccounts[0].ap_inbox_url).toBeDefined();

            // Get another page that will return no results and assert the
            // results are empty
            const nextFollowingAccountsEmpty =
                await service.getFollowingAccounts(account, {
                    limit: 2,
                    offset: 3,
                    fields: ['id', 'username', 'ap_inbox_url'],
                });

            expect(nextFollowingAccountsEmpty).toHaveLength(0);
        });
    });

    describe('getFollowingAccountsCount', () => {
        it('should retrieve the number of accounts that an account follows', async () => {
            const account = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'account',
            });
            const following1 = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'following1',
            });
            const following2 = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'following2',
            });

            await service.recordAccountFollow(following1, account);
            await service.recordAccountFollow(following2, account);

            const count = await service.getFollowingAccountsCount(account);

            expect(count).toBe(2);
        });
    });

    describe('getFollowerAccounts', () => {
        it('should retrieve the accounts that are following an account', async () => {
            const account = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'account',
            });
            const follower1 = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'follower1',
            });
            const follower2 = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'follower2',
            });
            const follower3 = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'follower3',
            });

            await service.recordAccountFollow(account, follower1);
            await service.recordAccountFollow(account, follower2);
            await service.recordAccountFollow(account, follower3);

            // Get a page of followers and assert the requested fields are returned
            const followers = await service.getFollowerAccounts(account, {
                limit: 2,
                offset: 0,
                fields: ['id', 'username', 'ap_inbox_url'],
            });

            expect(followers).toHaveLength(2);
            expect(followers[0]).toMatchObject({
                id: follower3.id,
                username: follower3.username,
            });
            expect(followers[0].ap_inbox_url).toBeDefined();

            expect(followers[1]).toMatchObject({
                id: follower2.id,
                username: follower2.username,
            });
            expect(followers[1].ap_inbox_url).toBeDefined();

            // Get the next page of followers and assert the requested fields are returned
            const nextFollowers = await service.getFollowerAccounts(account, {
                limit: 2,
                offset: 2,
                fields: ['id', 'username', 'ap_inbox_url'],
            });

            expect(nextFollowers).toHaveLength(1);
            expect(nextFollowers[0]).toMatchObject({
                id: follower1.id,
                username: follower1.username,
            });
            expect(nextFollowers[0].ap_inbox_url).toBeDefined();

            // Get another page that will return no results and assert the
            // results are empty
            const nextFollowersEmpty = await service.getFollowerAccounts(
                account,
                {
                    limit: 2,
                    offset: 3,
                    fields: ['id', 'username', 'ap_inbox_url'],
                },
            );

            expect(nextFollowersEmpty).toHaveLength(0);
        });
    });

    describe('getFollowerAccountsCount', () => {
        it('should retrieve the number of accounts that are following an account', async () => {
            const account = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'account',
            });
            const follower1 = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'follower1',
            });
            const follower2 = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'follower2',
            });

            await service.recordAccountFollow(account, follower1);
            await service.recordAccountFollow(account, follower2);

            const count = await service.getFollowerAccountsCount(account);

            expect(count).toBe(2);
        });
    });

    describe('checkIfAccountIsFollowing', () => {
        it('should check if an account is following another account', async () => {
            const account = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'account',
            });
            const followee = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'followee',
            });
            const nonFollowee = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'non-followee',
            });

            await service.recordAccountFollow(followee, account);

            const isFollowing = await service.checkIfAccountIsFollowing(
                account,
                followee,
            );

            expect(isFollowing).toBe(true);

            const isNotFollowing = await service.checkIfAccountIsFollowing(
                account,
                nonFollowee,
            );

            expect(isNotFollowing).toBe(false);
        });
    });

    it('should update accounts and emit an account.updated event if they have changed', async () => {
        const account = await service.createInternalAccount(site, {
            ...internalAccountData,
            username: 'account',
        });

        let accountFromEvent: Account | undefined;

        events.once('account.updated', (account) => {
            accountFromEvent = account;
        });

        await service.updateAccount(account, {
            name: 'A brand new name!',
        });

        expect(accountFromEvent).toBeDefined();

        const newAccount = await service.getByInternalId(account.id);

        expect(newAccount).toBeDefined();
        expect(newAccount!.name).toBe('A brand new name!');
    });
});
