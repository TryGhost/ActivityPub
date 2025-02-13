import { beforeEach, describe, expect, it, vi } from 'vitest';

import EventEmitter from 'node:events';

import { KnexAccountRepository } from '../account/account.repository.knex';
import { AccountService } from '../account/account.service';
import type { Account } from '../account/types';
import { FedifyContextFactory } from '../activitypub/fedify-context.factory';
import { TABLE_ACCOUNTS, TABLE_SITES, TABLE_USERS } from '../constants';
import { client as db } from '../db';
import { type IGhostService, type Site, SiteService } from './site.service';

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

describe('SiteService', () => {
    let service: SiteService;
    let accountService: AccountService;
    let ghostService: IGhostService;
    let site: Site;

    beforeEach(async () => {
        // Clean up the database
        await db.raw('SET FOREIGN_KEY_CHECKS = 0');
        await db(TABLE_SITES).truncate();
        await db(TABLE_USERS).truncate();
        await db(TABLE_ACCOUNTS).truncate();
        await db.raw('SET FOREIGN_KEY_CHECKS = 1');

        const events = new EventEmitter();
        const accountRepository = new KnexAccountRepository(db, events);
        const fedifyContextFactory = new FedifyContextFactory();
        accountService = new AccountService(
            db,
            events,
            accountRepository,
            fedifyContextFactory,
        );
        ghostService = {
            async getSiteSettings(host: string) {
                return {
                    site: {
                        icon: '',
                        title: 'Default Title',
                        description: 'Default Description',
                    },
                };
            },
        };
        // Create the service
        service = new SiteService(db, accountService, ghostService);
    });

    it('Can initialise a site multiple times and retrieve it', async () => {
        const existingSite = await service.getSiteByHost('hostname.tld');

        expect(existingSite).toBeNull();

        const createInternalAccount = vi.spyOn(
            accountService,
            'createInternalAccount',
        );

        const site = await service.initialiseSiteForHost('hostname.tld');

        expect(site.host).toBe('hostname.tld');
        expect(site.webhook_secret).toBeDefined();
        expect(site.id).toBeDefined();

        expect(createInternalAccount.mock.calls).toHaveLength(1);

        const siteRows = await db(TABLE_SITES).select('*');

        expect(siteRows).toHaveLength(1);

        const siteRow = siteRows[0];

        expect(siteRow.id).toBe(site.id);
        expect(siteRow.webhook_secret).toBe(site.webhook_secret);
        expect(siteRow.host).toBe(site.host);

        const siteTwo = await service.initialiseSiteForHost('hostname.tld');

        expect(siteTwo).toMatchObject(site);

        const siteRowsAfterSecondInit = await db(TABLE_SITES).select('*');

        expect(siteRowsAfterSecondInit).toHaveLength(1);

        const retrievedSite = await service.getSiteByHost('hostname.tld');

        expect(retrievedSite).toMatchObject(site);
    });

    it('Can update the default account for a host', async () => {
        const updateAccount = vi
            .spyOn(accountService, 'updateAccount')
            .mockResolvedValue({} as unknown as Account);

        const site = await service.initialiseSiteForHost('updating.tld');
        const account = await accountService.getDefaultAccountForSite(site);

        await service.refreshSiteDataForHost('updating.tld');

        expect(updateAccount.mock.lastCall?.[0]).toMatchObject(account);
        expect(updateAccount.mock.lastCall?.[1]).toMatchObject({
            avatar_url: '',
            name: 'Default Title',
            bio: 'Default Description',
        });
    });
});
