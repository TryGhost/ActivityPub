import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Knex } from 'knex';

import { KnexAccountRepository } from '@/account/account.repository.knex';
import { AccountService } from '@/account/account.service';
import { FedifyContextFactory } from '@/activitypub/fedify-context.factory';
import { AsyncEvents } from '@/core/events';
import { type IGhostService, SiteService } from '@/site/site.service';
import { generateTestCryptoKeyPair } from '@/test/crypto-key-pair';
import { createTestDb } from '@/test/db';

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
            async getSiteSettings(_host: string) {
                return {
                    site: {
                        icon: '',
                        title: 'Default Title',
                        description: 'Default Description',
                        cover_image: 'https://testing.com/cover.png',
                        site_uuid: 'e604ed82-188c-4f55-a5ce-9ebfb4184970',
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
        expect(site.ghost_uuid).toBeDefined();

        expect(createInternalAccount.mock.calls).toHaveLength(1);

        const siteRows = await db('sites').select('*');

        expect(siteRows).toHaveLength(1);

        const siteRow = siteRows[0];

        expect(siteRow.id).toBe(site.id);
        expect(siteRow.webhook_secret).toBe(site.webhook_secret);
        expect(siteRow.host).toBe(site.host);
        expect(siteRow.ghost_uuid).toBe(site.ghost_uuid);

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
        expect(site.ghost_uuid).toBeDefined();

        const siteRows = await db('sites').select('*');

        expect(siteRows).toHaveLength(1);

        const siteRow = siteRows[0];

        expect(siteRow.id).toBe(site.id);
        expect(siteRow.webhook_secret).toBe(site.webhook_secret);
        expect(siteRow.host).toBe(site.host);
        expect(siteRow.ghost_pro).toBe(1);
        expect(siteRow.ghost_uuid).toBe(site.ghost_uuid);
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

    it('Throws an error when a site does not have a site_uuid', async () => {
        ghostService.getSiteSettings = vi.fn().mockResolvedValue({
            site: {
                icon: '',
                title: 'Default Title',
                description: 'Default Description',
                cover_image: 'https://testing.com/cover.png',
            },
        });

        await expect(
            service.initialiseSiteForHost('hostname.tld'),
        ).rejects.toThrow('Site hostname.tld has no site_uuid');
    });

    it('Creates account with settings when site exists but account does not', async () => {
        // Manually create site without account
        await db('sites').insert({
            host: 'hostname.tld',
            webhook_secret: 'secret',
            ghost_uuid: 'some-uuid',
        });

        const site = await service.initialiseSiteForHost('hostname.tld');

        // Verify account was created with settings from Ghost
        const account = await db('accounts')
            .join('users', 'accounts.id', 'users.account_id')
            .where('users.site_id', site.id)
            .first();

        expect(account).toBeDefined();
        expect(account.name).toBe('Default Title');
    });

    it('Handles duplicate ghost_uuid when a site changes domains', async () => {
        const ghostUUID = 'some-ghost-uuid';

        ghostService.getSiteSettings = vi.fn().mockResolvedValue({
            site: {
                icon: 'https://domain-a.tld/icon.png',
                title: 'Site A title',
                description: 'Site A description',
                cover_image: 'https://domain-a.tld/cover.png',
                site_uuid: ghostUUID,
            },
        });

        const siteA = await service.initialiseSiteForHost('domain-a.tld');

        expect(siteA.host).toBe('domain-a.tld');
        expect(siteA.ghost_uuid).toBe(ghostUUID);

        // When domain-b.tld initialises with the same ghost_uuid,
        // the old host (domain-a.tld) no longer claims it
        ghostService.getSiteSettings = vi
            .fn()
            .mockImplementation((host: string) => {
                if (host === 'domain-a.tld') {
                    return Promise.resolve({
                        site: {
                            icon: 'https://domain-a.tld/icon.png',
                            title: 'Site A title',
                            description: 'Site A description',
                            cover_image: 'https://domain-a.tld/cover.png',
                            site_uuid: null,
                        },
                    });
                }
                return Promise.resolve({
                    site: {
                        icon: 'https://domain-b.tld/icon.png',
                        title: 'Site B title',
                        description: 'Site B description',
                        cover_image: 'https://domain-b.tld/cover.png',
                        site_uuid: ghostUUID,
                    },
                });
            });

        const siteB = await service.initialiseSiteForHost('domain-b.tld');

        expect(siteB.host).toBe('domain-b.tld');
        expect(siteB.ghost_uuid).toBe(ghostUUID);

        // Verify both sites exist
        const allSites = await db('sites').select('*').orderBy('id', 'asc');
        expect(allSites).toHaveLength(2);

        // Verify old site has null ghost_uuid
        const oldSite = allSites.find((s) => s.host === 'domain-a.tld');
        expect(oldSite).toBeDefined();
        expect(oldSite?.ghost_uuid).toBeNull();

        // Verify new site has the ghost_uuid
        const newSite = allSites.find((s) => s.host === 'domain-b.tld');
        expect(newSite).toBeDefined();
        expect(newSite?.ghost_uuid).toBe(ghostUUID);
    });

    it('Rejects ghost_uuid reassignment when the existing host still claims it', async () => {
        const ghostUUID = 'existing-ghost-uuid';

        ghostService.getSiteSettings = vi.fn().mockResolvedValue({
            site: {
                icon: 'https://site-a.tld/icon.png',
                title: 'Site A',
                description: 'Site A description',
                cover_image: 'https://site-a.tld/cover.png',
                site_uuid: ghostUUID,
            },
        });

        const siteA = await service.initialiseSiteForHost('site-a.tld');

        expect(siteA.ghost_uuid).toBe(ghostUUID);

        // A different host tries to register with the same ghost_uuid,
        // but the existing host (site-a.tld) still claims it
        ghostService.getSiteSettings = vi
            .fn()
            .mockImplementation((host: string) => {
                if (host === 'site-a.tld') {
                    return Promise.resolve({
                        site: {
                            icon: 'https://site-a.tld/icon.png',
                            title: 'Site A',
                            description: 'Site A description',
                            cover_image: 'https://site-a.tld/cover.png',
                            site_uuid: ghostUUID,
                        },
                    });
                }
                return Promise.resolve({
                    site: {
                        icon: 'https://site-b.tld/icon.png',
                        title: 'Site B',
                        description: 'Site B description',
                        cover_image: 'https://site-b.tld/cover.png',
                        site_uuid: ghostUUID,
                    },
                });
            });

        await expect(
            service.initialiseSiteForHost('site-b.tld'),
        ).rejects.toThrow('ghost_uuid is still claimed by another host');

        // Verify existing site is untouched
        const siteARow = await db('sites')
            .where({ host: 'site-a.tld' })
            .first();
        expect(siteARow.ghost_uuid).toBe(ghostUUID);

        // Verify new site was not created
        const siteBRow = await db('sites')
            .where({ host: 'site-b.tld' })
            .first();

        expect(siteBRow).toBeUndefined();
    });

    it('Allows ghost_uuid reassignment when the old host is unreachable', async () => {
        const ghostUUID = 'migrating-ghost-uuid';

        ghostService.getSiteSettings = vi.fn().mockResolvedValue({
            site: {
                icon: 'https://old-domain.tld/icon.png',
                title: 'Original site',
                description: 'Original description',
                cover_image: 'https://old-domain.tld/cover.png',
                site_uuid: ghostUUID,
            },
        });

        await service.initialiseSiteForHost('old-domain.tld');

        // Old host is unreachable (domain decommissioned)
        ghostService.getSiteSettings = vi
            .fn()
            .mockImplementation((host: string) => {
                if (host === 'old-domain.tld') {
                    const dnsError = Object.assign(
                        new Error('getaddrinfo ENOTFOUND old-domain.tld'),
                        { code: 'ENOTFOUND' },
                    );

                    return Promise.reject(dnsError);
                }
                return Promise.resolve({
                    site: {
                        icon: 'https://new-domain.tld/icon.png',
                        title: 'Migrated site',
                        description: 'Migrated description',
                        cover_image: 'https://new-domain.tld/cover.png',
                        site_uuid: ghostUUID,
                    },
                });
            });

        const newSite = await service.initialiseSiteForHost('new-domain.tld');

        expect(newSite.ghost_uuid).toBe(ghostUUID);

        // Old site's ghost_uuid should be nullified
        const oldRow = await db('sites')
            .where({ host: 'old-domain.tld' })
            .first();

        expect(oldRow.ghost_uuid).toBeNull();
    });

    it('Blocks ghost_uuid reassignment when the old host returns a transient HTTP error', async () => {
        const ghostUUID = 'transient-error-uuid';

        ghostService.getSiteSettings = vi.fn().mockResolvedValue({
            site: {
                icon: 'https://site-a.tld/icon.png',
                title: 'Site A',
                description: 'Site A description',
                cover_image: 'https://site-a.tld/cover.png',
                site_uuid: ghostUUID,
            },
        });

        await service.initialiseSiteForHost('site-a.tld');

        // Old host returns an HTTP error (has a response property)
        const httpError = Object.assign(
            new Error('Request failed with status code 500'),
            { response: { status: 500 } },
        );

        ghostService.getSiteSettings = vi
            .fn()
            .mockImplementation((host: string) => {
                if (host === 'site-a.tld') {
                    return Promise.reject(httpError);
                }
                return Promise.resolve({
                    site: {
                        icon: 'https://site-b.tld/icon.png',
                        title: 'Site B',
                        description: 'Site B description',
                        cover_image: 'https://site-b.tld/cover.png',
                        site_uuid: ghostUUID,
                    },
                });
            });

        await expect(
            service.initialiseSiteForHost('site-b.tld'),
        ).rejects.toThrow(
            'Unable to verify ghost_uuid ownership: site-a.tld returned an error',
        );

        // Verify existing site is untouched
        const siteARow = await db('sites')
            .where({ host: 'site-a.tld' })
            .first();

        expect(siteARow.ghost_uuid).toBe(ghostUUID);

        // Verify new site was not created
        const siteBRow = await db('sites')
            .where({ host: 'site-b.tld' })
            .first();

        expect(siteBRow).toBeUndefined();
    });
});
