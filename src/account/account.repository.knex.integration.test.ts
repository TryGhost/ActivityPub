import { afterAll, describe, it } from 'vitest';

import assert from 'node:assert';
import EventEmitter from 'node:events';
import { KnexAccountRepository } from '../account/account.repository.knex';
import { AccountService } from '../account/account.service';
import { FedifyContextFactory } from '../activitypub/fedify-context.factory';
import { client } from '../db';
import { SiteService } from '../site/site.service';
import { Account } from './account.entity';

afterAll(async () => {
    await client.destroy();
});

describe('KnexAccountRepository', () => {
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
});
