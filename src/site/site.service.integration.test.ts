import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TABLE_SITES } from '../constants';
import { client as db } from '../db';

import { AccountService } from '../account/account.service';
import type { Account } from '../account/types';
import { type Site, SiteService } from './site.service';

describe('SiteService', () => {
    let service: SiteService;
    let accountService: AccountService;
    let site: Site;

    beforeEach(async () => {
        // Clean up the database
        await db.raw('SET FOREIGN_KEY_CHECKS = 0');
        await db(TABLE_SITES).truncate();
        await db.raw('SET FOREIGN_KEY_CHECKS = 1');

        accountService = Object.create(AccountService.prototype);
        // Create the service
        service = new SiteService(db, accountService);
    });

    it('Can initialise a site multiple times and retrieve it', async () => {
        const existingSite = await service.getSiteByHost('hostname.tld');

        expect(existingSite).toBeNull();

        const createInternalAccount = vi
            .spyOn(accountService, 'createInternalAccount')
            .mockResolvedValue({} as unknown as Account);

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
});
