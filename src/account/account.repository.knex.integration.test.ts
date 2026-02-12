import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import assert from 'node:assert';

import { exportJwk } from '@fedify/fedify';
import type { Knex } from 'knex';

import { AccountEntity } from '@/account/account.entity';
import { KnexAccountRepository } from '@/account/account.repository.knex';
import { AccountCreatedEvent } from '@/account/events';
import { AccountUpdatedEvent } from '@/account/events/account-updated.event';
import { AsyncEvents } from '@/core/events';
import type { Site } from '@/site/site.service';
import {
    createExternalAccountDraftData,
    createInternalAccountDraftData,
} from '@/test/account-entity-test-helpers';
import { createTestDb } from '@/test/db';
import { createFixtureManager, type FixtureManager } from '@/test/fixtures';

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

    it('Can get by inbox url', async () => {
        const [, [account2]] = await Promise.all([
            fixtureManager.createInternalAccount(),
            fixtureManager.createInternalAccount(),
        ]);

        const result = await accountRepository.getByInboxUrl(
            new URL(account2.apInbox!),
        );

        assert(result, 'Account should have been found');
        assert(
            result.apId.href === account2.apId.href,
            'Account should have correct data',
        );
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

        // Verify that the event contains the account ID
        const event = emitSpy.mock.calls[0][1] as AccountUpdatedEvent;
        expect(event.getAccountId()).toBe(updated.id);

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
        const bobAccount = await fixtureManager.createExternalAccount();

        // Create Charlie using the same site as Bob
        const charlieAccount = await fixtureManager.createExternalAccount(
            bobAccount.url.href,
        );

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
        const blockedDomain = bobAccount.url;
        const aliceWithDomainBlock = aliceAccount.blockDomain(blockedDomain);

        // Save the domain block
        await accountRepository.save(aliceWithDomainBlock);

        // Verify the domain block was created
        const domainBlocks = await client('domain_blocks').select('*');
        expect(domainBlocks).toHaveLength(1);
        expect(domainBlocks[0].blocker_id).toBe(aliceAccount.id);
        expect(domainBlocks[0].domain).toBe(blockedDomain.hostname);

        // Verify all follow relationships with accounts from the blocked domain have been removed
        const followsAfter = await client('follows').select('*');
        expect(followsAfter).toHaveLength(1);
        expect(followsAfter[0]).toMatchObject({
            follower_id: bobAccount.id,
            following_id: charlieAccount.id,
        });
    });

    it('handles inserting a row into the follows table when an account has been followed', async () => {
        const [[account], [accountToFollow]] = await Promise.all([
            fixtureManager.createInternalAccount(null, 'example.com'),
            fixtureManager.createInternalAccount(null, 'followed.com'),
            fixtureManager.createInternalAccount(null, 'notfollowed.com'),
        ]);

        const followsBefore = await client('follows').select(
            'follower_id',
            'following_id',
        );

        expect(followsBefore).toStrictEqual([]);

        const updated = account.follow(accountToFollow);

        await accountRepository.save(updated);

        const follows = await client('follows').select(
            'follower_id',
            'following_id',
        );

        expect(follows).toStrictEqual([
            {
                follower_id: account.id,
                following_id: accountToFollow.id,
            },
        ]);
    });

    it('handles removing rows from the follows table when an account has been unfollowed', async () => {
        const [[account], [accountToFollow], [accountNotFollowed]] =
            await Promise.all([
                fixtureManager.createInternalAccount(null, 'example.com'),
                fixtureManager.createInternalAccount(null, 'followed.com'),
                fixtureManager.createInternalAccount(
                    null,
                    'notfollowedbyexample.com',
                ),
            ]);

        await accountRepository.save(account.follow(accountToFollow));
        await accountRepository.save(
            accountToFollow.follow(accountNotFollowed),
        );

        const followsBeforeUnfollow = await client('follows').select(
            'follower_id',
            'following_id',
        );

        expect(followsBeforeUnfollow).toHaveLength(2);
        expect(followsBeforeUnfollow).toEqual(
            expect.arrayContaining([
                {
                    follower_id: account.id,
                    following_id: accountToFollow.id,
                },
                {
                    follower_id: accountToFollow.id,
                    following_id: accountNotFollowed.id,
                },
            ]),
        );

        await accountRepository.save(account.unfollow(accountToFollow));

        const follows = await client('follows').select(
            'follower_id',
            'following_id',
        );

        expect(follows).toStrictEqual([
            {
                follower_id: accountToFollow.id,
                following_id: accountNotFollowed.id,
            },
        ]);
    });

    it('Can create an external account from a draft', async () => {
        const draftData = await createExternalAccountDraftData({
            username: 'test',
            name: 'Test',
            bio: 'Test bio',
            url: new URL('https://example.com'),
            avatarUrl: new URL('https://example.com/avatar.png'),
            bannerImageUrl: new URL('https://example.com/banner.png'),
            customFields: { foo: 'bar' },
            apId: new URL('https://example.com/ap/id'),
            apFollowers: new URL('https://example.com/ap/followers'),
            apInbox: new URL('https://example.com/ap/inbox'),
            apSharedInbox: new URL('https://example.com/ap/shared-inbox'),
            apOutbox: new URL('https://example.com/ap/outbox'),
            apFollowing: new URL('https://example.com/ap/following'),
            apLiked: new URL('https://example.com/ap/liked'),
        });

        const draft = AccountEntity.draft(draftData);

        const createdAccount = await accountRepository.create(draft);

        expect(createdAccount).toBeInstanceOf(AccountEntity);

        expect(createdAccount.id).toBeDefined();
        expect(createdAccount.uuid).toBeDefined();
        expect(createdAccount.username).toBe(draft.username);
        expect(createdAccount.name).toBe(draft.name);
        expect(createdAccount.bio).toBe(draft.bio);
        expect(createdAccount.url).toStrictEqual(draft.url);
        expect(createdAccount.avatarUrl).toStrictEqual(draft.avatarUrl);
        expect(createdAccount.bannerImageUrl).toStrictEqual(
            draft.bannerImageUrl,
        );
        expect(createdAccount.customFields).toStrictEqual(draft.customFields);
        expect(createdAccount.apId).toStrictEqual(draft.apId);
        expect(createdAccount.apFollowers).toStrictEqual(draft.apFollowers);
        expect(createdAccount.apInbox).toStrictEqual(draft.apInbox);
        expect(createdAccount.isInternal).toBe(false);

        // We need to check the fetched account to make sure everything was persisted correctly
        const fetchedAccount = await accountRepository.getById(
            createdAccount.id,
        );

        if (!fetchedAccount) {
            throw new Error('Account not found');
        }

        expect(fetchedAccount).toBeInstanceOf(AccountEntity);

        expect(fetchedAccount.id).toBe(createdAccount.id);
        expect(fetchedAccount.uuid).toBe(createdAccount.uuid);
        expect(fetchedAccount.username).toBe(createdAccount.username);
        expect(fetchedAccount.name).toBe(createdAccount.name);
        expect(fetchedAccount.bio).toBe(createdAccount.bio);
        expect(fetchedAccount.url).toStrictEqual(createdAccount.url);
        expect(fetchedAccount.avatarUrl).toStrictEqual(
            createdAccount.avatarUrl,
        );
        expect(fetchedAccount.bannerImageUrl).toStrictEqual(
            createdAccount.bannerImageUrl,
        );
        expect(fetchedAccount.customFields).toStrictEqual(
            createdAccount.customFields,
        );
        expect(fetchedAccount.apId).toStrictEqual(createdAccount.apId);
        expect(fetchedAccount.apFollowers).toStrictEqual(
            createdAccount.apFollowers,
        );
        expect(fetchedAccount.apInbox).toStrictEqual(createdAccount.apInbox);
        expect(fetchedAccount.isInternal).toBe(false);

        const dbRow = await client('accounts')
            .where('id', createdAccount.id)
            .first();

        expect(dbRow.ap_shared_inbox_url).toBe(draft.apSharedInbox?.href);
        expect(dbRow.ap_outbox_url).toBe(draft.apOutbox?.href);
        expect(dbRow.ap_following_url).toBe(draft.apFollowing?.href);
        expect(dbRow.ap_liked_url).toBe(draft.apLiked?.href);
        expect(dbRow.domain).toBe(draft.apId.hostname);
        expect(JSON.parse(dbRow.ap_public_key)).toStrictEqual(
            await exportJwk(draft.apPublicKey),
        );
    });

    it('Can create an internal account from a draft', async () => {
        const site = await fixtureManager.createSite();
        const draftData = await createInternalAccountDraftData({
            host: new URL(`https://${site.host}`),
            username: 'test',
            name: 'Test',
            bio: 'Test bio',
            url: new URL(`https://${site.host}`),
            avatarUrl: new URL(`https://${site.host}/avatar.png`),
            bannerImageUrl: new URL(`https://${site.host}/banner.png`),
            customFields: {
                foo: 'bar',
            },
        });

        const draft = AccountEntity.draft(draftData);

        const createdAccount = await accountRepository.create(draft);

        expect(createdAccount).toBeInstanceOf(AccountEntity);

        expect(createdAccount.id).toBeDefined();
        expect(createdAccount.uuid).toBeDefined();
        expect(createdAccount.username).toBe(draft.username);
        expect(createdAccount.name).toBe(draft.name);
        expect(createdAccount.bio).toBe(draft.bio);
        expect(createdAccount.url).toStrictEqual(draft.url);
        expect(createdAccount.avatarUrl).toStrictEqual(draft.avatarUrl);
        expect(createdAccount.bannerImageUrl).toStrictEqual(
            draft.bannerImageUrl,
        );
        expect(createdAccount.customFields).toStrictEqual(draft.customFields);
        expect(createdAccount.apId).toStrictEqual(draft.apId);
        expect(createdAccount.apFollowers).toStrictEqual(draft.apFollowers);
        expect(createdAccount.apInbox).toStrictEqual(draft.apInbox);
        expect(createdAccount.isInternal).toBe(true);

        // We need to check the fetched account to make sure everything was persisted correctly
        const fetchedAccount = await accountRepository.getById(
            createdAccount.id,
        );

        if (!fetchedAccount) {
            throw new Error('Account not found');
        }

        expect(fetchedAccount).toBeInstanceOf(AccountEntity);

        expect(fetchedAccount.id).toBe(createdAccount.id);
        expect(fetchedAccount.uuid).toBe(createdAccount.uuid);
        expect(fetchedAccount.username).toBe(createdAccount.username);
        expect(fetchedAccount.name).toBe(createdAccount.name);
        expect(fetchedAccount.bio).toBe(createdAccount.bio);
        expect(fetchedAccount.url).toStrictEqual(createdAccount.url);
        expect(fetchedAccount.avatarUrl).toStrictEqual(
            createdAccount.avatarUrl,
        );
        expect(fetchedAccount.bannerImageUrl).toStrictEqual(
            createdAccount.bannerImageUrl,
        );
        expect(fetchedAccount.customFields).toStrictEqual(
            createdAccount.customFields,
        );
        expect(fetchedAccount.apId).toStrictEqual(createdAccount.apId);
        expect(fetchedAccount.apFollowers).toStrictEqual(
            createdAccount.apFollowers,
        );
        expect(fetchedAccount.apInbox).toStrictEqual(createdAccount.apInbox);
        expect(fetchedAccount.isInternal).toBe(true);

        const dbRow = await client('accounts')
            .where('id', createdAccount.id)
            .first();

        expect(dbRow.ap_shared_inbox_url).toBe(null);
        expect(dbRow.ap_outbox_url).toBe(draft.apOutbox!.href);
        expect(dbRow.ap_following_url).toBe(draft.apFollowing!.href);
        expect(dbRow.ap_liked_url).toBe(draft.apLiked!.href);
        expect(dbRow.domain).toBe(draft.apId.hostname);
        expect(JSON.parse(dbRow.ap_public_key)).toStrictEqual(
            await exportJwk(draft.apPublicKey),
        );
        expect(JSON.parse(dbRow.ap_private_key)).toStrictEqual(
            await exportJwk(draft.apPrivateKey!),
        );
    });

    it('uses AccountEntity.fromDraft when creating an account', async () => {
        const fromDraftSpy = vi.spyOn(AccountEntity, 'fromDraft');

        const site = await fixtureManager.createSite();
        const draftData = await createInternalAccountDraftData({
            host: new URL(`https://${site.host}`),
            username: 'testuser',
            name: 'Test User',
            bio: 'Test bio',
            url: new URL(`https://${site.host}/user`),
            avatarUrl: new URL(`https://${site.host}/avatar.png`),
            bannerImageUrl: new URL(`https://${site.host}/banner.png`),
            customFields: {
                foo: 'bar',
            },
        });

        const draft = AccountEntity.draft(draftData);

        const createdAccount = await accountRepository.create(draft);

        expect(fromDraftSpy).toHaveBeenCalledWith(draft, createdAccount.id);
        expect(fromDraftSpy).toHaveBeenCalledTimes(1);

        fromDraftSpy.mockRestore();
    });

    it('Handles events when creating an account', async () => {
        const emitSpy = vi.spyOn(events, 'emitAsync');

        const fromDraftSpy = vi.spyOn(AccountEntity, 'fromDraft');

        const site = await fixtureManager.createSite();
        const draftData = await createInternalAccountDraftData({
            host: new URL(`https://${site.host}`),
            username: 'mockuser',
            name: 'Mock User',
            bio: 'User for mocking',
            url: new URL(`https://${site.host}/mockuser`),
            avatarUrl: null,
            bannerImageUrl: null,
            customFields: null,
        });

        const draft = AccountEntity.draft(draftData);

        await accountRepository.create(draft);

        expect(emitSpy).toHaveBeenCalledWith(
            AccountCreatedEvent.getName(),
            expect.any(AccountCreatedEvent),
        );
        expect(emitSpy).toHaveBeenCalledTimes(1);

        emitSpy.mockRestore();
        fromDraftSpy.mockRestore();
    });

    it('Can create an account entity from a database row', async () => {
        const [account] = await fixtureManager.createInternalAccount();

        const row = await client('accounts').where('id', account.id).first();

        assert(row);

        const accountFromRow = await accountRepository.createFromRow(row);

        expect(accountFromRow.id).toBe(account.id);
        expect(accountFromRow.uuid).toBe(account.uuid);
        expect(accountFromRow.username).toBe(account.username);
        expect(accountFromRow.name).toBe(account.name);
        expect(accountFromRow.bio).toBe(account.bio);
        expect(accountFromRow.url.href).toBe(account.url.href);
        expect(accountFromRow.avatarUrl?.href).toBe(account.avatarUrl?.href);
        expect(accountFromRow.bannerImageUrl?.href).toBe(
            account.bannerImageUrl?.href,
        );
        expect(accountFromRow.apId.href).toBe(account.apId.href);
        expect(accountFromRow.apFollowers?.href).toBe(
            account.apFollowers?.href,
        );
        expect(accountFromRow.apInbox?.href).toBe(account.apInbox?.href);
        expect(accountFromRow.customFields).toEqual(account.customFields);
        expect(accountFromRow.isInternal).toBe(account.isInternal);
    });
});
