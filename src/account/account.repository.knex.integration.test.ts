import { beforeAll, describe, expect, it, vi } from 'vitest';

import assert from 'node:assert';
import { AsyncEvents } from 'core/events';
import type { Knex } from 'knex';
import { generateTestCryptoKeyPair } from 'test/crypto-key-pair';
import { createTestDb } from 'test/db';
import { KnexAccountRepository } from '../account/account.repository.knex';
import { AccountService } from '../account/account.service';
import { FedifyContextFactory } from '../activitypub/fedify-context.factory';
import { SiteService } from '../site/site.service';
import { AccountUpdatedEvent } from './account-updated.event';
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

    it('emits AccountUpdatedEvent when an account is saved', async () => {
        // Setup
        const events = new AsyncEvents();
        const accountRepository = new KnexAccountRepository(client, events);
        const emitSpy = vi.spyOn(events, 'emitAsync');

        // Get an account from the DB to update
        const account = await client('accounts').select('*').first();

        if (!account) {
            throw new Error('No account found for test');
        }

        // Create an Account entity
        const accountEntity = new Account(
            account.id,
            account.uuid || 'test-uuid',
            account.username,
            'Updated Name', // Change the name
            'Updated Bio', // Change the bio
            account.avatar_url ? new URL(account.avatar_url) : null,
            account.banner_image_url ? new URL(account.banner_image_url) : null,
            null, // site
            account.ap_id ? new URL(account.ap_id) : null,
            account.url ? new URL(account.url) : null,
            account.ap_followers_url ? new URL(account.ap_followers_url) : null,
        );

        // Act
        await accountRepository.save(accountEntity);

        // Assert
        expect(emitSpy).toHaveBeenCalledWith(
            AccountUpdatedEvent.getName(),
            expect.any(AccountUpdatedEvent),
        );

        // Verify that the event contains the account
        const event = emitSpy.mock.calls[0][1] as AccountUpdatedEvent;
        expect(event.getAccount()).toBe(accountEntity);

        // Verify the database was updated
        const updatedAccount = await client('accounts')
            .where({ id: account.id })
            .first();

        expect(updatedAccount.name).toBe('Updated Name');
        expect(updatedAccount.bio).toBe('Updated Bio');
    });
});
