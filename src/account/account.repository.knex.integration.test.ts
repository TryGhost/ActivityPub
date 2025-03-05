import { beforeAll, describe, it } from 'vitest';

import assert from 'node:assert';
import EventEmitter from 'node:events';
import type { Knex } from 'knex';
import { createTestDb } from 'test/db';
import { KnexAccountRepository } from '../account/account.repository.knex';
import { AccountService } from '../account/account.service';
import { FedifyContextFactory } from '../activitypub/fedify-context.factory';
import { SiteService } from '../site/site.service';
import { Account } from './account.entity';

describe('KnexAccountRepository', () => {
    let client: Knex;
    beforeAll(async () => {
        client = await createTestDb();
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
    it('Can get by site', async () => {
        const events = new EventEmitter();
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

        const account = await accountRepository.getBySite(site);

        assert(
            account instanceof Account,
            'An Account should have been fetched',
        );
    });
    it('Ensures an account has a uuid when retrieved for a site', async () => {
        const events = new EventEmitter();
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

        const account = await accountRepository.getBySite(site);

        assert(account.uuid !== null, 'Account should have a uuid');
    });
    it('Can get by apId', async () => {
        const events = new EventEmitter();
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
        const events = new EventEmitter();
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
});
