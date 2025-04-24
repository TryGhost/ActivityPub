import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import assert from 'node:assert';
import { AsyncEvents } from 'core/events';
import type { Knex } from 'knex';
import { generateTestCryptoKeyPair } from 'test/crypto-key-pair';
import { createTestDb } from 'test/db';
import { KnexAccountRepository } from '../account/account.repository.knex';
import { AccountService } from '../account/account.service';
import { FedifyContextFactory } from '../activitypub/fedify-context.factory';
import { type Site, SiteService } from '../site/site.service';
import { AccountUpdatedEvent } from './account-updated.event';
import { AccountEntity } from './account.entity';

describe('KnexAccountRepository', () => {
    let client: Knex;
    let events: AsyncEvents;
    let accountRepository: KnexAccountRepository;
    let fedifyContextFactory: FedifyContextFactory;
    let accountService: AccountService;
    let siteService: SiteService;

    beforeAll(async () => {
        client = await createTestDb();
    });

    beforeEach(async () => {
        await client.raw('SET FOREIGN_KEY_CHECKS = 0');
        await client('accounts').truncate();
        await client('users').truncate();
        await client('sites').truncate();
        await client.raw('SET FOREIGN_KEY_CHECKS = 1');

        events = new AsyncEvents();
        accountRepository = new KnexAccountRepository(client, events);
        fedifyContextFactory = new FedifyContextFactory();
        accountService = new AccountService(
            client,
            events,
            accountRepository,
            fedifyContextFactory,
            generateTestCryptoKeyPair,
        );
        siteService = new SiteService(client, accountService, {
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
        const site = await siteService.initialiseSiteForHost('testing.com');

        const account = await accountRepository.getBySite(site);

        assert(
            account instanceof AccountEntity,
            'An Account should have been fetched',
        );
    });

    it('Ensures an account has a uuid when retrieved for a site', async () => {
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
        const emitSpy = vi.spyOn(events, 'emitAsync');

        await siteService.initialiseSiteForHost('testing.com');

        // Get an account from the DB to update
        const account = await client('accounts').select('*').first();

        if (!account) {
            throw new Error('No account found for test');
        }

        const accountEntity = await accountRepository.getBySite({
            id: 1,
        } as Site);

        const updated = accountEntity.updateProfile({
            name: 'Updated Name',
            bio: 'Updated Bio',
        });

        // Act
        await accountRepository.save(updated);

        // Assert
        expect(emitSpy).toHaveBeenCalledWith(
            AccountUpdatedEvent.getName(),
            expect.any(AccountUpdatedEvent),
        );

        // Verify that the event contains the account
        const event = emitSpy.mock.calls[0][1] as AccountUpdatedEvent;
        expect(event.getAccount()).toBe(updated);

        // Verify the database was updated
        const updatedAccount = await client('accounts')
            .where({ id: account.id })
            .first();

        expect(updatedAccount.name).toBe('Updated Name');
        expect(updatedAccount.bio).toBe('Updated Bio');
    });

    it('handles saving a new account when avatarUrl or bannerImageUrl with null values', async () => {
        // Setup
        await siteService.initialiseSiteForHost('testing.com');

        // Get an account from the DB to update
        const account = await client('accounts').select('*').first();

        if (!account) {
            throw new Error('No account found for test');
        }

        const accountEntity = await accountRepository.getBySite({
            id: 1,
        } as Site);

        const firstUpdated = accountEntity.updateProfile({
            avatarUrl: new URL('https://example.com/avatar.png'),
            bannerImageUrl: new URL('https://example.com/banner.png'),
        });

        await accountRepository.save(firstUpdated);

        const secondUpdated = accountEntity.updateProfile({
            avatarUrl: null,
            bannerImageUrl: null,
        });

        await accountRepository.save(secondUpdated);

        // Assert

        // Verify the database was updated
        const updatedAccount = await client('accounts')
            .where({ id: account.id })
            .first();

        expect(updatedAccount.avatar_url).toBe(null);
        expect(updatedAccount.banner_image_url).toBe(null);
    });
});
