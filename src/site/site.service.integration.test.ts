import { beforeEach, describe, expect, it } from 'vitest';

import { TABLE_SITES } from '../constants';
import { client as db } from '../db';

import { type Site, SiteService } from './site.service';

describe('SiteService', () => {
    let service: SiteService;
    let site: Site;

    beforeEach(async () => {
        // Clean up the database
        await db.raw('SET FOREIGN_KEY_CHECKS = 0');
        await db(TABLE_SITES).truncate();
        await db.raw('SET FOREIGN_KEY_CHECKS = 1');

        // Create the service
        service = new SiteService(db);
    });

    it('Can initialise a site multiple times and retrieve it', async () => {
        const existingSite = await service.getSiteByHost('hostname.tld');

        expect(existingSite).toBeNull();

        const site = await service.initialiseSiteForHost('hostname.tld');

        expect(site.host).toBe('hostname.tld');
        expect(site.webhook_secret).toBeDefined();
        expect(site.id).toBeDefined();

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
