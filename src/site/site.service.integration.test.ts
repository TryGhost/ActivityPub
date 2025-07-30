import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AsyncEvents } from 'core/events';
import type { Knex } from 'knex';
import { generateTestCryptoKeyPair } from 'test/crypto-key-pair';
import { createTestDb } from 'test/db';
import { KnexAccountRepository } from '../account/account.repository.knex';
import { AccountService } from '../account/account.service';
import { FedifyContextFactory } from '../activitypub/fedify-context.factory';
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
    let db: Knex;

    beforeAll(async () => {
        db = await createTestDb();
    });

    beforeEach(async () => {
        // Clean up the database
        await db.raw('SET FOREIGN_KEY_CHECKS = 0');
        await db('sites').truncate();
        await db('users').truncate();
        await db('accounts').truncate();
        await db.raw('SET FOREIGN_KEY_CHECKS = 1');

        const events = new AsyncEvents();
        const accountRepository = new KnexAccountRepository(db, events);
        const fedifyContextFactory = new FedifyContextFactory();
        accountService = new AccountService(
            db,
            events,
            accountRepository,
            fedifyContextFactory,
            generateTestCryptoKeyPair,
        );
        ghostService = {
            async getSiteSettings(host: string) {
                return {
                    site: {
                        icon: '',
                        title: 'Default Title',
                        description: 'Default Description',
                        cover_image: 'https://testing.com/cover.png',
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

        const siteRows = await db('sites').select('*');

        expect(siteRows).toHaveLength(1);

        const siteRow = siteRows[0];

        expect(siteRow.id).toBe(site.id);
        expect(siteRow.webhook_secret).toBe(site.webhook_secret);
        expect(siteRow.host).toBe(site.host);

        const siteTwo = await service.initialiseSiteForHost('hostname.tld');

        expect(siteTwo).toMatchObject(site);

        const siteRowsAfterSecondInit = await db('sites').select('*');

        expect(siteRowsAfterSecondInit).toHaveLength(1);

        const retrievedSite = await service.getSiteByHost('hostname.tld');

        expect(retrievedSite).toMatchObject(site);
    });

    it('Can initialise a site with the `ghost_pro` flag', async () => {
        const site = await service.initialiseSiteForHost('hostname.tld', true);

        expect(site.host).toBe('hostname.tld');
        expect(site.webhook_secret).toBeDefined();
        expect(site.id).toBeDefined();

        const siteRows = await db('sites').select('*');

        expect(siteRows).toHaveLength(1);

        const siteRow = siteRows[0];

        expect(siteRow.id).toBe(site.id);
        expect(siteRow.webhook_secret).toBe(site.webhook_secret);
        expect(siteRow.host).toBe(site.host);
        expect(siteRow.ghost_pro).toBe(1);
    });

    it('Can disable a site', async () => {
        await service.initialiseSiteForHost('hostname.tld');

        const result = await service.disableSiteForHost('hostname.tld');

        expect(result).toBe(true);

        const siteRows = await db('sites').select('*');

        expect(siteRows).toHaveLength(0);
    });

    it('Can disable a site that does not exist', async () => {
        await service.initialiseSiteForHost('hostname.tld');

        const result = await service.disableSiteForHost('hostname.com'); // Different host

        expect(result).toBe(false);

        const siteRows = await db('sites').select('*');

        expect(siteRows).toHaveLength(1);
    });
});
