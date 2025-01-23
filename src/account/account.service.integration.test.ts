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

import EventEmitter from 'node:events';
import { AccountService } from './account.service';
import type { Account, ExternalAccountData, Site } from './types';

describe('AccountService', () => {
    let service: AccountService;
    let events: EventEmitter;
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

        events = new EventEmitter();

        // Create the service
        service = new AccountService(db, events);
    });

    describe('createInternalAccount', () => {
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

                const account = await service.createInternalAccount(
                    site,
                    username,
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
            },
            1000 * 10, // Increase timeout to 10 seconds as 5 seconds seems to be too short on CI
        );
    });

    describe('createExternalAccount', () => {
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
    });

    describe('recordAccountFollow', () => {
        it('should record an account being followed', async () => {
            const account = await service.createInternalAccount(
                site,
                'account',
            );
            const follower = await service.createInternalAccount(
                site,
                'follower',
            );

            await service.recordAccountFollow(account, follower);

            // Assert the follow was inserted into the database
            const follows = await db(TABLE_FOLLOWS).select('*');

            expect(follows).toHaveLength(1);

            const follow = follows[0];

            expect(follow.following_id).toBe(account.id);
            expect(follow.follower_id).toBe(follower.id);
        });

        it('should not record duplicate follows', async () => {
            const account = await service.createInternalAccount(
                site,
                'account',
            );
            const follower = await service.createInternalAccount(
                site,
                'follower',
            );

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
            const account = await service.createInternalAccount(
                site,
                'account',
            );

            const retrievedAccount = await service.getAccountByApId(
                account.ap_id,
            );

            // Assert the retrieved account matches the created account
            expect(retrievedAccount).toMatchObject(account);
        });
    });

    describe('getDefaultAccountForSite', () => {
        it('should retrieve the default account for a site', async () => {
            const account = await service.createInternalAccount(
                site,
                'account',
            );

            const defaultAccount = await service.getDefaultAccountForSite(site);

            expect(defaultAccount).toMatchObject(account);
        });

        it('should throw an error if multiple users are found for a site', async () => {
            await service.createInternalAccount(site, 'account1');
            await service.createInternalAccount(site, 'account2');

            await expect(
                service.getDefaultAccountForSite(site),
            ).rejects.toThrow(`Multiple users found for site: ${site.id}`);
        });

        it('should throw an error if no users are found for a site', async () => {
            await expect(
                service.getDefaultAccountForSite(site),
            ).rejects.toThrow(`No user found for site: ${site.id}`);
        });
    });

    describe('getFollowedAccounts', () => {
        it(
            'should retrieve the accounts that an account follows',
            async () => {
                const account = await service.createInternalAccount(
                    site,
                    'account',
                );
                const follower1 = await service.createInternalAccount(
                    site,
                    'follower1',
                );
                const follower2 = await service.createInternalAccount(
                    site,
                    'follower2',
                );
                const follower3 = await service.createInternalAccount(
                    site,
                    'follower3',
                );

                await service.recordAccountFollow(follower1, account);
                await service.recordAccountFollow(follower2, account);
                await service.recordAccountFollow(follower3, account);

                // Get a page of followed accounts and assert the requested fields are returned
                const followedAccounts = await service.getFollowedAccounts(
                    account,
                    {
                        limit: 2,
                        offset: 0,
                        fields: ['id', 'username', 'ap_inbox_url'],
                    },
                );

                expect(followedAccounts).toHaveLength(2);
                expect(followedAccounts[0]).toMatchObject({
                    id: follower3.id,
                    username: follower3.username,
                });
                expect(followedAccounts[0].ap_inbox_url).toBeDefined();

                expect(followedAccounts[1]).toMatchObject({
                    id: follower2.id,
                    username: follower2.username,
                });
                expect(followedAccounts[1].ap_inbox_url).toBeDefined();

                // Get the next page of followed accounts and assert the requested fields are returned
                const nextFollowedAccounts = await service.getFollowedAccounts(
                    account,
                    {
                        limit: 2,
                        offset: 2,
                        fields: ['id', 'username', 'ap_inbox_url'],
                    },
                );

                expect(nextFollowedAccounts).toHaveLength(1);
                expect(nextFollowedAccounts[0]).toMatchObject({
                    id: follower1.id,
                    username: follower1.username,
                });
                expect(nextFollowedAccounts[0].ap_inbox_url).toBeDefined();

                // Get another page that will return no results and assert the
                // results are empty
                const nextFollowedAccountsEmpty =
                    await service.getFollowedAccounts(account, {
                        limit: 2,
                        offset: 3,
                        fields: ['id', 'username', 'ap_inbox_url'],
                    });

                expect(nextFollowedAccountsEmpty).toHaveLength(0);
            },
            1000 * 10, // Increase timeout to 10 seconds as 5 seconds seems to be too short on CI
        );
    });

    describe('getFollowingCount', () => {
        it(
            'should retrieve the following count for an account',
            async () => {
                const account = await service.createInternalAccount(
                    site,
                    'account',
                );
                const following1 = await service.createInternalAccount(
                    site,
                    'following1',
                );
                const following2 = await service.createInternalAccount(
                    site,
                    'following2',
                );
                const following3 = await service.createInternalAccount(
                    site,
                    'following3',
                );

                await service.recordAccountFollow(following1, account);
                await service.recordAccountFollow(following2, account);
                await service.recordAccountFollow(following3, account);

                const rows = await db('follows').select('*');

                // Get a page of followed accounts and assert the requested fields are returned
                const followingCount = await service.getFollowingCount(account);

                expect(followingCount).toBe(3);
            },
            1000 * 10, // Increase timeout to 10 seconds as 5 seconds seems to be too short on CI
        );
    });

    describe('getFollowerCount', () => {
        it(
            'should retrieve the follower count for an account',
            async () => {
                const account = await service.createInternalAccount(
                    site,
                    'account',
                );
                const follower1 = await service.createInternalAccount(
                    site,
                    'follower1',
                );
                const follower2 = await service.createInternalAccount(
                    site,
                    'follower2',
                );
                const follower3 = await service.createInternalAccount(
                    site,
                    'follower3',
                );

                await service.recordAccountFollow(account, follower1);
                await service.recordAccountFollow(account, follower2);
                await service.recordAccountFollow(account, follower3);

                const rows = await db('follows').select('*');

                // Get a page of followed accounts and assert the requested fields are returned
                const followerCount = await service.getFollowerCount(account);

                expect(followerCount).toBe(3);
            },
            1000 * 10, // Increase timeout to 10 seconds as 5 seconds seems to be too short on CI
        );
    });

    it('should update accounts and emit an account.updated event if they have changed', async () => {
        const account = await service.createInternalAccount(
            site,
            'testing-update',
        );

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
