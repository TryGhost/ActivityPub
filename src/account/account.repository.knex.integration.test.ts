import { afterAll, describe, it } from 'vitest';

import assert from 'node:assert';
import EventEmitter from 'node:events';
import { KnexAccountRepository } from '../account/account.repository.knex';
import { AccountService } from '../account/account.service';
import { client } from '../db';
import { SiteService } from '../site/site.service';
import { Account } from './account.entity';

afterAll(async () => {
    await client.destroy();
});

describe('KnexAccountRepository', () => {
    it('Can get by site', async () => {
        const events = new EventEmitter();
        const accountService = new AccountService(client, events);
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
        const accountRepository = new KnexAccountRepository(client, events);

        const site = await siteService.initialiseSiteForHost('testing.com');

        const account = await accountRepository.getBySite(site);

        assert(
            account instanceof Account,
            'An Account should have been fetched',
        );
    });
});
