import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import assert from 'node:assert';
import type { Knex } from 'knex';

import { AsyncEvents } from 'core/events';
import { createTestDb } from 'test/db';
import { type FixtureManager, createFixtureManager } from 'test/fixtures';
import { KnexAccountRepository } from '../account/account.repository.knex';
import type { Site } from '../site/site.service';
import { AccountUpdatedEvent } from './account-updated.event';
import { AccountEntity } from './account.entity';

describe('KnexAccountRepository', () => {
    let client: Knex;
    let fixtureManager: FixtureManager;
    let events: AsyncEvents;
    let accountRepository: KnexAccountRepository;

    beforeAll(async () => {
        client = await createTestDb();
        fixtureManager = createFixtureManager(client);
        events = new AsyncEvents();
        accountRepository = new KnexAccountRepository(client, events);
    });

    beforeEach(async () => {
        await fixtureManager.reset();
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
        const [, site] = await fixtureManager.createInternalAccount();

        const account = await accountRepository.getBySite(site);

        assert(
            account instanceof AccountEntity,
            'An Account should have been fetched',
        );
    });

    it('Ensures an account has a uuid when retrieved for a site', async () => {
        const [, site] = await fixtureManager.createInternalAccount();

        const siteDefaultAccount = await getSiteDefaultAccount(site.id);

        if (!siteDefaultAccount) {
            throw new Error('Account not found');
        }

        await removeUUIDFromAccount(siteDefaultAccount.id);

        const account = await accountRepository.getBySite(site);

        assert(account.uuid !== null, 'Account should have a uuid');
    });

    it('Can get by apId', async () => {
        const [, site] = await fixtureManager.createInternalAccount();

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
        const [, site] = await fixtureManager.createInternalAccount();

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

    it('Can get by id', async () => {
        const [, [account2]] = await Promise.all([
            fixtureManager.createInternalAccount(),
            fixtureManager.createInternalAccount(),
        ]);

        const result = await accountRepository.getById(account2.id);

        assert(result, 'Account should have been found');
        assert(
            result.apId.href === account2.apId.href,
            'Account should have correct data',
        );
    });

    it('Ensures an account has a uuid when retrieved by id', async () => {
        const [, [account2]] = await Promise.all([
            fixtureManager.createInternalAccount(),
            fixtureManager.createInternalAccount(),
        ]);

        const result = await accountRepository.getById(account2.id);

        assert(result, 'Account should have been found');
        assert(result.uuid !== null, 'Account should have a uuid');
    });

    it('emits AccountUpdatedEvent when an account is saved', async () => {
        // Setup
        const emitSpy = vi.spyOn(events, 'emitAsync');

        await fixtureManager.createInternalAccount();

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

    it('handles saving a new account when avatarUrl or bannerImageUrl have null values', async () => {
        // Setup
        await fixtureManager.createInternalAccount();

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

    it('handles inserting a row into the blocks table when an account has been blocked', async () => {
        const [[account], [accountToBlock]] = await Promise.all([
            fixtureManager.createInternalAccount(null, 'example.com'),
            fixtureManager.createInternalAccount(null, 'blocked1.com'),
        ]);

        const blocksBefore = await client('blocks').select(
            'blocked_id',
            'blocker_id',
        );

        expect(blocksBefore).toStrictEqual([]);

        const updated = account.block(accountToBlock);

        await accountRepository.save(updated);

        const blocks = await client('blocks').select(
            'blocked_id',
            'blocker_id',
        );

        expect(blocks).toStrictEqual([
            {
                blocked_id: accountToBlock.id,
                blocker_id: account.id,
            },
        ]);
    });

    it('handles removing a row from the blocks table when an account has been unblocked', async () => {
        const [[account], [accountToUnblock]] = await Promise.all([
            fixtureManager.createInternalAccount(null, 'example.com'),
            fixtureManager.createInternalAccount(null, 'blocked1.com'),
        ]);

        // First, block the account
        const updatedWithBlock = account.block(accountToUnblock);
        await accountRepository.save(updatedWithBlock);

        // Verify the block was added
        const blocksAfterBlock = await client('blocks').select(
            'blocked_id',
            'blocker_id',
        );

        expect(blocksAfterBlock).toStrictEqual([
            {
                blocked_id: accountToUnblock.id,
                blocker_id: account.id,
            },
        ]);

        // Now unblock the account
        const updatedWithUnblock = account.unblock(accountToUnblock);
        await accountRepository.save(updatedWithUnblock);

        // Verify the block was removed
        const blocksAfterUnblock = await client('blocks').select(
            'blocked_id',
            'blocker_id',
        );

        expect(blocksAfterUnblock).toStrictEqual([]);
    });

    it('handles blocking the same account multiple times without creating duplicate blocks', async () => {
        const [[account], [accountToBlock]] = await Promise.all([
            fixtureManager.createInternalAccount(null, 'example.com'),
            fixtureManager.createInternalAccount(null, 'blocked1.com'),
        ]);

        // First block
        const firstBlockedAccount = account.block(accountToBlock);
        await accountRepository.save(firstBlockedAccount);

        // Get the block count after first block
        const blocksAfterFirstBlock = await client('blocks')
            .count('* as count')
            .first();

        expect(blocksAfterFirstBlock?.count).toBe(1);

        // Second block (same account) - using the original account instance
        const secondBlockedAccount = account.block(accountToBlock);
        await accountRepository.save(secondBlockedAccount);

        // Verify no duplicate was created
        const blocksAfterSecondBlock = await client('blocks')
            .count('* as count')
            .first();

        expect(blocksAfterSecondBlock?.count).toBe(1);

        // Verify the block is correct
        const blocks = await client('blocks').select(
            'blocked_id',
            'blocker_id',
        );
        expect(blocks).toStrictEqual([
            {
                blocked_id: accountToBlock.id,
                blocker_id: account.id,
            },
        ]);
    });

    it('handles removing the follow relationship between blocker → blocked when an account has been blocked', async () => {
        const [[aliceAccount], [bobAccount]] = await Promise.all([
            fixtureManager.createInternalAccount(),
            fixtureManager.createInternalAccount(),
        ]);

        // alice follows bob
        await fixtureManager.createFollow(aliceAccount, bobAccount);

        // alice blocks bob
        const aliceWithBlock = aliceAccount.block(bobAccount);
        await accountRepository.save(aliceWithBlock);

        // Verify the follow relationship between alice and bob has been removed
        const follows = await client('follows').select('*');
        expect(follows).toStrictEqual([]);
    });

    it('handles removing the follow relationship between blocked → blocker when an account has been blocked', async () => {
        const [[aliceAccount], [bobAccount]] = await Promise.all([
            fixtureManager.createInternalAccount(),
            fixtureManager.createInternalAccount(),
        ]);

        // bob follows alice
        await fixtureManager.createFollow(bobAccount, aliceAccount);

        // alice blocks bob
        const aliceWithBlock = aliceAccount.block(bobAccount);
        await accountRepository.save(aliceWithBlock);

        // Verify the follow relationship between bob and alice has been removed
        const follows = await client('follows').select('*');
        expect(follows).toStrictEqual([]);
    });

    it('handles removing follow relationships when a domain is blocked', async () => {
        // Create Alice from a different domain
        const [aliceAccount] = await fixtureManager.createInternalAccount(
            null,
            'alice-domain.com',
        );

        // Create Bob from the domain to be blocked
        const [bobAccount, bobSite] =
            await fixtureManager.createInternalAccount(
                null,
                'blocked-domain.com',
            );

        // Create Charlie using the same site as Bob
        const [charlieAccount] =
            await fixtureManager.createInternalAccount(bobSite);

        // Create follow relationships:
        // 1. Alice follows Bob (will be removed when domain is blocked)
        // 2. Charlie follows Alice (will be removed when domain is blocked)
        await fixtureManager.createFollow(aliceAccount, bobAccount);
        await fixtureManager.createFollow(charlieAccount, aliceAccount);
        await fixtureManager.createFollow(bobAccount, charlieAccount);

        // Verify the follows exist
        const followsBefore = await client('follows').select('*');
        expect(followsBefore).toHaveLength(3);

        // Alice blocks the domain blocked-domain.com
        const blockedDomain = new URL('https://blocked-domain.com');
        const aliceWithDomainBlock = aliceAccount.blockDomain(blockedDomain);

        // Save the domain block
        await accountRepository.save(aliceWithDomainBlock);

        // Verify the domain block was created
        const domainBlocks = await client('domain_blocks').select('*');
        expect(domainBlocks).toHaveLength(1);
        expect(domainBlocks[0].blocker_id).toBe(aliceAccount.id);
        expect(domainBlocks[0].domain).toBe('blocked-domain.com');

        // Verify all follow relationships with accounts from the blocked domain have been removed
        const followsAfter = await client('follows').select('*');
        expect(followsAfter).toHaveLength(1);
        expect(followsAfter[0]).toMatchObject({
            follower_id: bobAccount.id,
            following_id: charlieAccount.id,
        });
    });
});
