import { beforeAll, beforeEach, describe, it } from 'vitest';

import assert from 'node:assert';
import { AsyncEvents } from 'core/events';
import type { Knex } from 'knex';
import { generateTestCryptoKeyPair } from 'test/crypto-key-pair';
import { createTestDb } from 'test/db';
import {
    dbCreateAccount,
    dbCreateFollow,
    dbCreateLike,
    dbCreatePost,
    dbCreateRepost,
} from 'test/fixtures';
import { KnexAccountRepository } from '../account/account.repository.knex';
import { AccountService } from '../account/account.service';
import { FedifyContextFactory } from '../activitypub/fedify-context.factory';
import { type Site, SiteService } from '../site/site.service';
import { Account } from './account.entity';
describe('KnexAccountRepository', () => {
    let client: Knex;
    beforeAll(async () => {
        client = await createTestDb();
    });
    beforeEach(async () => {
        await client.raw('SET FOREIGN_KEY_CHECKS = 0');
        await client('follows').truncate();
        await client('likes').truncate();
        await client('reposts').truncate();
        await client('posts').truncate();
        await client('users').truncate();
        await client('accounts').truncate();
        await client('sites').truncate();
        await client.raw('SET FOREIGN_KEY_CHECKS = 1');
    });
    const getSiteDefaultAccount = async (siteId: number) => {
        return await client('accounts')
            .innerJoin('users', 'accounts.id', 'users.account_id')
            .innerJoin('sites', 'users.site_id', 'sites.id')
            .where('sites.id', siteId)
            .first();
    };

    const removeUUIDFromAccount = async (accountId: number) => {
        await client('accounts').update({ uuid: null }).where('id', accountId);

        const account = await client('accounts').where('id', accountId).first();

        assert(account.uuid === null, 'Account should not have a uuid');
    };

    const setupFixturesForCountTests = async (
        site: Site,
        account: { id: number },
    ) => {
        // Create accounts that will follow / be followed
        const followingAccount1 = await dbCreateAccount(client, site);
        const followingAccount2 = await dbCreateAccount(client, site);
        const followingAccount3 = await dbCreateAccount(client, site);
        const followingAccount4 = await dbCreateAccount(client, site);
        const followingAccount5 = await dbCreateAccount(client, site);
        const followerAccount1 = await dbCreateAccount(client, site);
        const followerAccount2 = await dbCreateAccount(client, site);
        const followerAccount3 = await dbCreateAccount(client, site);
        const followerAccount4 = await dbCreateAccount(client, site);
        const followerAccount5 = await dbCreateAccount(client, site);
        const followerAccount6 = await dbCreateAccount(client, site);

        // Create follows for provided account
        await dbCreateFollow(client, account, followingAccount1);
        await dbCreateFollow(client, account, followingAccount2);
        await dbCreateFollow(client, account, followingAccount3);
        await dbCreateFollow(client, account, followingAccount4);
        await dbCreateFollow(client, account, followingAccount5);
        await dbCreateFollow(client, followerAccount1, account);
        await dbCreateFollow(client, followerAccount2, account);
        await dbCreateFollow(client, followerAccount3, account);
        await dbCreateFollow(client, followerAccount4, account);
        await dbCreateFollow(client, followerAccount5, account);
        await dbCreateFollow(client, followerAccount6, account);

        // Create misc follows for created accounts - This is to add extra data
        // into table so we can ensure the filtering on the count queries is
        // working as expected
        await dbCreateFollow(client, followerAccount1, followingAccount1);
        await dbCreateFollow(client, followerAccount1, followingAccount2);
        await dbCreateFollow(client, followerAccount2, followingAccount1);
        await dbCreateFollow(client, followerAccount3, followingAccount1);

        // Create posts for the provided account
        const post1 = await dbCreatePost(client, account, site);
        const post2 = await dbCreatePost(client, account, site);

        // Create misc posts for the created accounts
        const post3 = await dbCreatePost(client, followingAccount1, site);
        const post4 = await dbCreatePost(client, followingAccount2, site);
        const post5 = await dbCreatePost(client, followingAccount3, site);
        const post6 = await dbCreatePost(client, followingAccount4, site);
        const post7 = await dbCreatePost(client, followingAccount5, site);
        const post8 = await dbCreatePost(client, followerAccount1, site);

        // Create likes for the provided account
        await dbCreateLike(client, account, post3);
        await dbCreateLike(client, account, post4);
        await dbCreateLike(client, account, post5);

        // Create misc likes for the created accounts - This is to add extra data
        // into table so we can ensure the filtering on the count queries is
        // working as expected
        await dbCreateLike(client, followerAccount3, post1);
        await dbCreateLike(client, followerAccount3, post2);
        await dbCreateLike(client, followerAccount4, post2);

        // Create reposts for the provided account
        await dbCreateRepost(client, account, post5);
        await dbCreateRepost(client, account, post6);
        await dbCreateRepost(client, account, post7);
        await dbCreateRepost(client, account, post8);

        // Create misc reposts for the created accounts - This is to add extra data
        // into table so we can ensure the filtering on the count queries is
        // working as expected
        await dbCreateRepost(client, followerAccount1, post1);
        await dbCreateRepost(client, followerAccount2, post1);
    };
    it('Can get by site', async () => {
        const events = new AsyncEvents();
        const accountRepository = new KnexAccountRepository(client, events);
        const fedifyContextFactory = new FedifyContextFactory();
        const accountService = new AccountService(
            client,
            events,
            accountRepository,
            fedifyContextFactory,
            generateTestCryptoKeyPair,
        );
        const siteService = new SiteService(client, accountService, {
            async getSiteSettings(host: string) {
                return {
                    site: {
                        title: 'Test Site',
                        description: 'A fake site used for testing',
                        icon: 'https://testing.com/favicon.ico',
                    },
                };
            },
        });

        const site = await siteService.initialiseSiteForHost('testing.com');

        const account = await accountRepository.getBySite(site);

        assert(
            account instanceof Account,
            'An Account should have been fetched',
        );
    });
    it('Ensures an account has the correct counts when retrieved by site', async () => {
        const events = new AsyncEvents();
        const accountRepository = new KnexAccountRepository(client, events);
        const fedifyContextFactory = new FedifyContextFactory();
        const accountService = new AccountService(
            client,
            events,
            accountRepository,
            fedifyContextFactory,
            generateTestCryptoKeyPair,
        );
        const siteService = new SiteService(client, accountService, {
            async getSiteSettings(host: string) {
                return {
                    site: {
                        title: 'Test Site',
                        description: 'A fake site used for testing',
                        icon: 'https://testing.com/favicon.ico',
                    },
                };
            },
        });

        const site = await siteService.initialiseSiteForHost('testing.com');
        const account = await getSiteDefaultAccount(site.id);

        await setupFixturesForCountTests(site, account);

        const result = await accountRepository.getBySite(site);

        assert(result);
        assert(result.postCount === 2);
        assert(result.likedPostCount === 3);
        assert(result.repostCount === 4);
        assert(result.followingCount === 5);
        assert(result.followerCount === 6);
    });
    it('Ensures an account has a uuid when retrieved for a site', async () => {
        const events = new AsyncEvents();
        const accountRepository = new KnexAccountRepository(client, events);
        const fedifyContextFactory = new FedifyContextFactory();
        const accountService = new AccountService(
            client,
            events,
            accountRepository,
            fedifyContextFactory,
            generateTestCryptoKeyPair,
        );
        const siteService = new SiteService(client, accountService, {
            async getSiteSettings(host: string) {
                return {
                    site: {
                        title: 'Test Site',
                        description: 'A fake site used for testing',
                        icon: 'https://testing.com/favicon.ico',
                    },
                };
            },
        });

        const site = await siteService.initialiseSiteForHost('testing.com');

        const siteDefaultAccount = await getSiteDefaultAccount(site.id);

        if (!siteDefaultAccount) {
            throw new Error('Account not found');
        }

        await removeUUIDFromAccount(siteDefaultAccount.id);

        const account = await accountRepository.getBySite(site);

        assert(account.uuid !== null, 'Account should have a uuid');
    });
    it('Can get by apId', async () => {
        const events = new AsyncEvents();
        const accountRepository = new KnexAccountRepository(client, events);
        const fedifyContextFactory = new FedifyContextFactory();
        const accountService = new AccountService(
            client,
            events,
            accountRepository,
            fedifyContextFactory,
            generateTestCryptoKeyPair,
        );
        const siteService = new SiteService(client, accountService, {
            async getSiteSettings(host: string) {
                return {
                    site: {
                        title: 'Test Site',
                        description: 'A fake site used for testing',
                        icon: 'https://testing.com/favicon.ico',
                    },
                };
            },
        });

        const site = await siteService.initialiseSiteForHost('testing.com');

        const account = await accountRepository.getBySite(site);

        const row = await client('accounts')
            .where({ id: account.id })
            .select('ap_id')
            .first();

        const url = new URL(row.ap_id);

        const result = await accountRepository.getByApId(url);

        assert(result);
    });
    it('Ensures an account has a uuid when retrieved by apId', async () => {
        const events = new AsyncEvents();
        const accountRepository = new KnexAccountRepository(client, events);
        const fedifyContextFactory = new FedifyContextFactory();
        const accountService = new AccountService(
            client,
            events,
            accountRepository,
            fedifyContextFactory,
        );
        const siteService = new SiteService(client, accountService, {
            async getSiteSettings(host: string) {
                return {
                    site: {
                        title: 'Test Site',
                        description: 'A fake site used for testing',
                        icon: 'https://testing.com/favicon.ico',
                    },
                };
            },
        });

        const site = await siteService.initialiseSiteForHost('testing.com');

        const siteDefaultAccount = await getSiteDefaultAccount(site.id);

        if (!siteDefaultAccount) {
            throw new Error('Account not found');
        }

        await removeUUIDFromAccount(siteDefaultAccount.id);

        const row = await client('accounts')
            .where({ id: siteDefaultAccount.id })
            .select('ap_id')
            .first();

        const url = new URL(row.ap_id);

        const result = await accountRepository.getByApId(url);

        assert(result, 'Account should have been found');
        assert(result.uuid !== null, 'Account should have a uuid');
    });
    it('Ensures an account has the correct counts when retrieved by apId', async () => {
        const events = new AsyncEvents();
        const accountRepository = new KnexAccountRepository(client, events);
        const fedifyContextFactory = new FedifyContextFactory();
        const accountService = new AccountService(
            client,
            events,
            accountRepository,
            fedifyContextFactory,
            generateTestCryptoKeyPair,
        );
        const siteService = new SiteService(client, accountService, {
            async getSiteSettings(host: string) {
                return {
                    site: {
                        title: 'Test Site',
                        description: 'A fake site used for testing',
                        icon: 'https://testing.com/favicon.ico',
                    },
                };
            },
        });

        const site = await siteService.initialiseSiteForHost('testing.com');
        const account = await accountRepository.getBySite(site);
        const row = await client('accounts')
            .where({ id: account.id })
            .select('id', 'ap_id')
            .first();
        const url = new URL(row.ap_id);

        await setupFixturesForCountTests(site, row);

        const result = await accountRepository.getByApId(url);

        assert(result);
        assert(result.postCount === 2);
        assert(result.likedPostCount === 3);
        assert(result.repostCount === 4);
        assert(result.followingCount === 5);
        assert(result.followerCount === 6);
    });
});
