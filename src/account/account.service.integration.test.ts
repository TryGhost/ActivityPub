import { type Actor, type Note, isActor, lookupObject } from '@fedify/fedify';
import type { FedifyContextFactory } from 'activitypub/fedify-context.factory';
import {
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import { AsyncEvents } from 'core/events';
import { getError, getValue, isError } from 'core/result';
import type { Knex } from 'knex';
import { generateTestCryptoKeyPair } from 'test/crypto-key-pair';
import { createTestDb } from 'test/db';
import { AP_BASE_PATH } from '../constants';
import { AccountFollowedEvent } from './account-followed.event';
import { KnexAccountRepository } from './account.repository.knex';
import { AccountService } from './account.service';
import type { ExternalAccountData, InternalAccountData, Site } from './types';

vi.mock('@fedify/fedify', async () => {
    // generateCryptoKeyPair is a slow operation so we generate a key pair
    // upfront and re-use it for all tests
    const original = await vi.importActual('@fedify/fedify');

    // @ts-expect-error - generateCryptoKeyPair is not typed
    const keyPair = await original.generateCryptoKeyPair();

    return {
        ...original,
        generateCryptoKeyPair: vi.fn().mockReturnValue(keyPair),
        lookupObject: vi.fn(),
        isActor: vi.fn(),
    };
});

describe('AccountService', () => {
    let service: AccountService;
    let events: AsyncEvents;
    let site: Site;
    let internalAccountData: InternalAccountData;
    let externalAccountData: ExternalAccountData;
    let db: Knex;

    const mockActor = {
        id: new URL('https://example.com/activitypub/users/testuser'),
        type: 'Person',
        name: 'Test User',
        preferredUsername: 'testuser',
        inbox: new URL('https://example.com/activitypub/inbox/testuser'),
        outbox: new URL('https://example.com/activitypub/outbox/testuser'),
        following: new URL(
            'https://example.com/activitypub/following/testuser',
        ),
        followers: new URL(
            'https://example.com/activitypub/followers/testuser',
        ),
        liked: new URL('https://example.com/activitypub/liked/testuser'),
        getAttachments: vi.fn().mockImplementation(async function* () {}),
        getPublicKey: vi.fn().mockResolvedValue({
            toJsonLd: vi.fn().mockResolvedValue({
                id: 'https://example.com/activitypub/users/testuser#main-key',
                owner: 'https://example.com/activitypub/users/testuser',
                publicKeyPem:
                    '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...\n-----END PUBLIC KEY-----',
            }),
        }),
        getIcon: vi.fn().mockResolvedValue(null),
        getImage: vi.fn().mockResolvedValue(null),
        summary: null,
        url: new URL('https://example.com/users/testuser'),
    };

    vi.mocked(lookupObject).mockResolvedValue(mockActor as unknown as Actor);
    vi.mocked(isActor).mockReturnValue(true);

    beforeAll(async () => {
        db = await createTestDb();
    });

    afterEach(() => {
        events.removeAllListeners();
    });

    beforeEach(async () => {
        vi.useRealTimers();

        // Clean up the database
        await db.raw('SET FOREIGN_KEY_CHECKS = 0');
        await db('follows').truncate();
        await db('accounts').truncate();
        await db('users').truncate();
        await db('sites').truncate();
        await db.raw('SET FOREIGN_KEY_CHECKS = 1');

        // Insert a site
        const siteData = {
            host: 'www.example.com',
            webhook_secret: 'secret',
        };
        const [id] = await db('sites').insert(siteData);

        site = {
            id,
            ...siteData,
        };

        // Init reusable account data
        internalAccountData = {
            username: 'index',
            name: 'Test Site Title',
            bio: 'Test Site Description',
            avatar_url: 'Test Site Icon',
        };
        externalAccountData = {
            username: 'external-account',
            name: 'External Account',
            bio: 'External Account Bio',
            avatar_url: 'https://www.example.com/avatars/external-account.png',
            banner_image_url:
                'https://www.example.com/banners/external-account.png',
            url: 'https://www.example.com/users/external-account',
            custom_fields: {},
            ap_id: 'https://www.example.com/activitypub/users/external-account',
            ap_inbox_url:
                'https://www.example.com/activitypub/inbox/external-account',
            ap_outbox_url:
                'https://www.example.com/activitypub/outbox/external-account',
            ap_following_url:
                'https://www.example.com/activitypub/following/external-account',
            ap_followers_url:
                'https://www.example.com/activitypub/followers/external-account',
            ap_liked_url:
                'https://www.example.com/activitypub/liked/external-account',
            ap_shared_inbox_url: null,
            ap_public_key: '',
        };

        // Init dependencies
        events = new AsyncEvents();
        const accountRepository = new KnexAccountRepository(db, events);
        const fedifyContextFactory = {
            getFedifyContext: () => ({
                getDocumentLoader: async () => ({}),
            }),
        } as unknown as FedifyContextFactory;

        // Create the service
        service = new AccountService(
            db,
            events,
            accountRepository,
            fedifyContextFactory,
            generateTestCryptoKeyPair,
        );
    });

    describe('createInternalAccount', () => {
        it('should create an internal account', async () => {
            const username = internalAccountData.username;

            const normalizedHost = site.host.replace(/^www\./, '');
            const expectedAccount = {
                name: internalAccountData.name || normalizedHost,
                username: username,
                bio: internalAccountData.bio || null,
                avatar_url: internalAccountData.avatar_url || null,
                url: `https://${site.host}`,
                custom_fields: null,
                ap_id: `https://${site.host}${AP_BASE_PATH}/users/${username}`,
                ap_inbox_url: `https://${site.host}${AP_BASE_PATH}/inbox/${username}`,
                ap_outbox_url: `https://${site.host}${AP_BASE_PATH}/outbox/${username}`,
                ap_following_url: `https://${site.host}${AP_BASE_PATH}/following/${username}`,
                ap_followers_url: `https://${site.host}${AP_BASE_PATH}/followers/${username}`,
                ap_liked_url: `https://${site.host}${AP_BASE_PATH}/liked/${username}`,
                ap_shared_inbox_url: null,
            };

            const account = await service.createInternalAccount(
                site,
                internalAccountData,
            );

            // Assert the created account was returned
            expect(account).toMatchObject(expectedAccount);
            expect(account.id).toBeGreaterThan(0);
            expect(account.ap_public_key).toBeDefined();
            expect(account.ap_public_key).toContain('key_ops');
            expect(account.ap_private_key).toBeDefined();
            expect(account.ap_private_key).toContain('key_ops');

            // Assert the account was inserted into the database
            const accounts = await db('accounts').select('*');

            expect(accounts).toHaveLength(1);

            const dbAccount = accounts[0];

            expect(dbAccount).toMatchObject(expectedAccount);

            // Assert the user was inserted into the database
            const users = await db('users').select('*');

            expect(users).toHaveLength(1);

            const dbUser = users[0];

            expect(dbUser.account_id).toBe(account.id);
            expect(dbUser.site_id).toBe(site.id);
        });

        it('transparently handle duplicates', async () => {
            const username = internalAccountData.username;

            const normalizedHost = site.host.replace(/^www\./, '');
            const expectedAccount = {
                name: internalAccountData.name || normalizedHost,
                username: username,
                bio: internalAccountData.bio || null,
                avatar_url: internalAccountData.avatar_url || null,
                url: `https://${site.host}`,
                custom_fields: null,
                ap_id: `https://${site.host}${AP_BASE_PATH}/users/${username}`,
                ap_inbox_url: `https://${site.host}${AP_BASE_PATH}/inbox/${username}`,
                ap_outbox_url: `https://${site.host}${AP_BASE_PATH}/outbox/${username}`,
                ap_following_url: `https://${site.host}${AP_BASE_PATH}/following/${username}`,
                ap_followers_url: `https://${site.host}${AP_BASE_PATH}/followers/${username}`,
                ap_liked_url: `https://${site.host}${AP_BASE_PATH}/liked/${username}`,
                ap_shared_inbox_url: null,
            };

            const account = await service.createInternalAccount(
                site,
                internalAccountData,
            );

            // Assert the created account was returned
            expect(account).toMatchObject(expectedAccount);
            expect(account.id).toBeGreaterThan(0);
            expect(account.ap_public_key).toBeDefined();
            expect(account.ap_public_key).toContain('key_ops');
            expect(account.ap_private_key).toBeDefined();
            expect(account.ap_private_key).toContain('key_ops');

            // Assert the account was inserted into the database
            const accounts = await db('accounts').select('*');

            expect(accounts).toHaveLength(1);

            const dbAccount = accounts[0];

            expect(dbAccount).toMatchObject(expectedAccount);

            // Assert the user was inserted into the database
            const users = await db('users').select('*');

            expect(users).toHaveLength(1);

            const dbUser = users[0];

            expect(dbUser.account_id).toBe(account.id);
            expect(dbUser.site_id).toBe(site.id);

            const secondAccount = await service.createInternalAccount(
                site,
                internalAccountData,
            );

            expect(secondAccount).toMatchObject(account);
        });

        it('should ensure the account is created with a domain', async () => {
            const account = await service.createInternalAccount(
                site,
                internalAccountData,
            );

            const accountRow = await db('accounts')
                .where({ id: account.id })
                .first();

            expect(accountRow.domain).toBe(site.host);
        });

        it('should create a user row for an existing account when migrating a site', async () => {
            // Simulate an account that already exists (e.g., from a previous external interaction)
            const username = internalAccountData.username;
            const apId = `https://${site.host}${AP_BASE_PATH}/users/${username}`;
            const accountData = {
                name: internalAccountData.name,
                uuid: 'test-uuid',
                username: username,
                bio: internalAccountData.bio,
                avatar_url: internalAccountData.avatar_url,
                banner_image_url: null,
                url: `https://${site.host}`,
                custom_fields: null,
                ap_id: apId,
                ap_inbox_url: `https://${site.host}${AP_BASE_PATH}/inbox/${username}`,
                ap_shared_inbox_url: null,
                ap_outbox_url: `https://${site.host}${AP_BASE_PATH}/outbox/${username}`,
                ap_following_url: `https://${site.host}${AP_BASE_PATH}/following/${username}`,
                ap_followers_url: `https://${site.host}${AP_BASE_PATH}/followers/${username}`,
                ap_liked_url: `https://${site.host}${AP_BASE_PATH}/liked/${username}`,
                ap_public_key: 'public-key',
                ap_private_key: null,
                domain: site.host,
            };
            // Insert the account directly (simulate external interaction)
            const [accountId] = await db('accounts').insert(accountData);

            // There should be no user row for this account and site yet
            let user = await db('users')
                .where({ account_id: accountId, site_id: site.id })
                .first();
            expect(user).toBeUndefined();

            // Call and capture the result to ensure the original account is reused
            const returned = await service.createInternalAccount(
                site,
                internalAccountData,
            );
            expect(returned.id).toBe(accountId);

            // Now, there should be a user row linking the site to the account
            user = await db('users')
                .where({ account_id: accountId, site_id: site.id })
                .first();
            expect(user).toBeDefined();
            expect(user.account_id).toBe(accountId);
            expect(user.site_id).toBe(site.id);
        });

        it('should generate a keypair for an existing account without private key during site migration', async () => {
            // Simulate an account that already exists but has no private key
            const username = internalAccountData.username;
            const apId = `https://${site.host}${AP_BASE_PATH}/users/${username}`;
            const accountData = {
                name: internalAccountData.name,
                uuid: 'test-uuid',
                username: username,
                bio: internalAccountData.bio,
                avatar_url: internalAccountData.avatar_url,
                banner_image_url: null,
                url: `https://${site.host}`,
                custom_fields: null,
                ap_id: apId,
                ap_inbox_url: `https://${site.host}${AP_BASE_PATH}/inbox/${username}`,
                ap_shared_inbox_url: null,
                ap_outbox_url: `https://${site.host}${AP_BASE_PATH}/outbox/${username}`,
                ap_following_url: `https://${site.host}${AP_BASE_PATH}/following/${username}`,
                ap_followers_url: `https://${site.host}${AP_BASE_PATH}/followers/${username}`,
                ap_liked_url: `https://${site.host}${AP_BASE_PATH}/liked/${username}`,
                ap_public_key: 'public-key',
                ap_private_key: null, // Note: no private key
                domain: site.host,
            };
            // Insert the account directly
            const [accountId] = await db('accounts').insert(accountData);

            // Get initial account state
            const beforeAccount = await db('accounts')
                .where('id', accountId)
                .first();
            expect(beforeAccount.ap_private_key).toBeNull();

            // Call createInternalAccount which should update the keypair
            await service.createInternalAccount(site, internalAccountData);

            // Verify the account now has a private key
            const updatedAccount = await db('accounts')
                .where('id', accountId)
                .first();
            expect(updatedAccount.ap_private_key).not.toBeNull();
            expect(updatedAccount.ap_public_key).not.toBe('public-key');
            expect(updatedAccount.ap_private_key).toContain('key_ops');
        });

        it('should return account with newly generated keys from createInternalAccount', async () => {
            // Simulate an account that already exists but has no private key
            const username = internalAccountData.username;
            const apId = `https://${site.host}${AP_BASE_PATH}/users/${username}`;
            const accountData = {
                name: internalAccountData.name,
                uuid: 'test-uuid',
                username: username,
                bio: internalAccountData.bio,
                avatar_url: internalAccountData.avatar_url,
                banner_image_url: null,
                url: `https://${site.host}`,
                custom_fields: null,
                ap_id: apId,
                ap_inbox_url: `https://${site.host}${AP_BASE_PATH}/inbox/${username}`,
                ap_shared_inbox_url: null,
                ap_outbox_url: `https://${site.host}${AP_BASE_PATH}/outbox/${username}`,
                ap_following_url: `https://${site.host}${AP_BASE_PATH}/following/${username}`,
                ap_followers_url: `https://${site.host}${AP_BASE_PATH}/followers/${username}`,
                ap_liked_url: `https://${site.host}${AP_BASE_PATH}/liked/${username}`,
                ap_public_key: 'old-public-key',
                ap_private_key: null, // Note: no private key
                domain: site.host,
            };
            // Insert the account directly
            await db('accounts').insert(accountData);

            // Call createInternalAccount and verify the returned account has updated keys
            const returnedAccount = await service.createInternalAccount(
                site,
                internalAccountData,
            );

            expect(returnedAccount.ap_private_key).not.toBeNull();
            expect(returnedAccount.ap_public_key).not.toBe('old-public-key');
            expect(returnedAccount.ap_private_key).toContain('key_ops');
            expect(returnedAccount.ap_public_key).toContain('key_ops');
        });

        it('should generate a keypair for an existing account without any keys during site migration', async () => {
            // Test case where account has neither public nor private key
            // This could happen if an account was created externally but incompletely
            const username = internalAccountData.username;
            const apId = `https://${site.host}${AP_BASE_PATH}/users/${username}`;
            const accountData = {
                name: internalAccountData.name,
                uuid: 'test-uuid',
                username: username,
                bio: internalAccountData.bio,
                avatar_url: internalAccountData.avatar_url,
                banner_image_url: null,
                url: `https://${site.host}`,
                custom_fields: null,
                ap_id: apId,
                ap_inbox_url: `https://${site.host}${AP_BASE_PATH}/inbox/${username}`,
                ap_shared_inbox_url: null,
                ap_outbox_url: `https://${site.host}${AP_BASE_PATH}/outbox/${username}`,
                ap_following_url: `https://${site.host}${AP_BASE_PATH}/following/${username}`,
                ap_followers_url: `https://${site.host}${AP_BASE_PATH}/followers/${username}`,
                ap_liked_url: `https://${site.host}${AP_BASE_PATH}/liked/${username}`,
                ap_public_key: null, // No public key either
                ap_private_key: null, // No private key
                domain: site.host,
            };
            // Insert the account directly
            const [accountId] = await db('accounts').insert(accountData);

            // Get initial account state
            const beforeAccount = await db('accounts')
                .where('id', accountId)
                .first();
            expect(beforeAccount.ap_private_key).toBeNull();
            expect(beforeAccount.ap_public_key).toBeNull();

            // Call createInternalAccount which should generate both keys
            const returnedAccount = await service.createInternalAccount(
                site,
                internalAccountData,
            );

            // Verify both keys were generated in the database
            const updatedAccount = await db('accounts')
                .where('id', accountId)
                .first();
            expect(updatedAccount.ap_private_key).not.toBeNull();
            expect(updatedAccount.ap_public_key).not.toBeNull();
            expect(updatedAccount.ap_private_key).toContain('key_ops');
            expect(updatedAccount.ap_public_key).toContain('key_ops');

            // Verify the returned account also has both keys
            expect(returnedAccount.ap_private_key).not.toBeNull();
            expect(returnedAccount.ap_public_key).not.toBeNull();
        });

        it('should handle empty string keys as missing keys during migration', async () => {
            // Test case where keys are empty strings instead of null
            // This prevents subtle bugs where empty strings aren't handled the same as null values
            const username = internalAccountData.username;
            const apId = `https://${site.host}${AP_BASE_PATH}/users/${username}`;
            const accountData = {
                name: internalAccountData.name,
                uuid: 'test-uuid',
                username: username,
                bio: internalAccountData.bio,
                avatar_url: internalAccountData.avatar_url,
                banner_image_url: null,
                url: `https://${site.host}`,
                custom_fields: null,
                ap_id: apId,
                ap_inbox_url: `https://${site.host}${AP_BASE_PATH}/inbox/${username}`,
                ap_shared_inbox_url: null,
                ap_outbox_url: `https://${site.host}${AP_BASE_PATH}/outbox/${username}`,
                ap_following_url: `https://${site.host}${AP_BASE_PATH}/following/${username}`,
                ap_followers_url: `https://${site.host}${AP_BASE_PATH}/followers/${username}`,
                ap_liked_url: `https://${site.host}${AP_BASE_PATH}/liked/${username}`,
                ap_public_key: '', // Empty string instead of null
                ap_private_key: '', // Empty string instead of null
                domain: site.host,
            };
            // Insert the account directly
            const [accountId] = await db('accounts').insert(accountData);

            // Get initial account state
            const beforeAccount = await db('accounts')
                .where('id', accountId)
                .first();
            expect(beforeAccount.ap_private_key).toBe('');
            expect(beforeAccount.ap_public_key).toBe('');

            // Call createInternalAccount which should treat empty strings as missing keys
            const returnedAccount = await service.createInternalAccount(
                site,
                internalAccountData,
            );

            // Verify new keys were generated despite empty strings being present
            const updatedAccount = await db('accounts')
                .where('id', accountId)
                .first();
            expect(updatedAccount.ap_private_key).not.toBe('');
            expect(updatedAccount.ap_public_key).not.toBe('');
            expect(updatedAccount.ap_private_key).toContain('key_ops');
            expect(updatedAccount.ap_public_key).toContain('key_ops');

            // Verify the returned account also has the new keys
            expect(returnedAccount.ap_private_key).not.toBe('');
            expect(returnedAccount.ap_public_key).not.toBe('');
        });
    });

    describe('createExternalAccount', () => {
        it('should create an external account', async () => {
            const account =
                await service.createExternalAccount(externalAccountData);

            // Assert the created account was returned
            expect(account).toMatchObject(externalAccountData);
            expect(account.id).toBeGreaterThan(0);

            // Assert the account was inserted into the database
            const accounts = await db('accounts').select('*');

            expect(accounts).toHaveLength(1);

            const dbAccount = accounts[0];

            expect(dbAccount).toMatchObject(externalAccountData);
        });

        it('should transparently handle duplicates', async () => {
            const account =
                await service.createExternalAccount(externalAccountData);

            // Assert the created account was returned
            expect(account).toMatchObject(externalAccountData);
            expect(account.id).toBeGreaterThan(0);

            // Assert the account was inserted into the database
            const accounts = await db('accounts').select('*');

            expect(accounts).toHaveLength(1);

            const dbAccount = accounts[0];

            expect(dbAccount).toMatchObject(externalAccountData);

            const secondAccount =
                await service.createExternalAccount(externalAccountData);

            expect(secondAccount).toMatchObject(account);
        });

        it('should ensure the account is created with a domain', async () => {
            const account =
                await service.createExternalAccount(externalAccountData);

            const accountRow = await db('accounts')
                .where({ id: account.id })
                .first();

            expect(accountRow.domain).toBe(site.host);
        });
    });

    describe('recordAccountUnfollow', () => {
        it('should record an account being unfollowed', async () => {
            const account = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'account',
            });
            const follower = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'follower',
            });

            await service.recordAccountFollow(account, follower);

            // Assert the follow was inserted into the database
            const follows = await db('follows').select('*');

            expect(follows).toHaveLength(1);

            const follow = follows[0];

            expect(follow.following_id).toBe(account.id);
            expect(follow.follower_id).toBe(follower.id);

            await service.recordAccountUnfollow(account, follower);

            const followsAfter = await db('follows').select('*');

            expect(followsAfter).toHaveLength(0);
        });
    });

    describe('recordAccountFollow', () => {
        it('should record an account being followed', async () => {
            const account = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'account',
            });
            const follower = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'follower',
            });

            await service.recordAccountFollow(account, follower);

            // Assert the follow was inserted into the database
            const follows = await db('follows').select('*');

            expect(follows).toHaveLength(1);

            const follow = follows[0];

            expect(follow.following_id).toBe(account.id);
            expect(follow.follower_id).toBe(follower.id);
        });

        it('should not record duplicate follows', async () => {
            const account = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'account',
            });
            const follower = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'follower',
            });

            await service.recordAccountFollow(account, follower);

            const firstFollow = await db('follows').where({ id: 1 }).first();

            await service.recordAccountFollow(account, follower);

            // Assert the follow was inserted into the database only once
            const follows = await db('follows').select('*');

            expect(follows).toHaveLength(1);

            // Assert the data was not changed
            const follow = follows[0];

            expect(follow.following_id).toBe(firstFollow.following_id);
            expect(follow.follower_id).toBe(firstFollow.follower_id);
            expect(follow.created_at).toStrictEqual(firstFollow.created_at);
            expect(follow.updated_at).toStrictEqual(firstFollow.updated_at);
        });

        it('should emit an account.followed event', async () => {
            let accountFollowedEvent: AccountFollowedEvent | undefined;

            events.on(AccountFollowedEvent.getName(), (event) => {
                accountFollowedEvent = event;
            });

            const account = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'account',
            });
            const follower = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'follower',
            });

            await service.recordAccountFollow(account, follower);

            await vi.waitFor(() => {
                return accountFollowedEvent !== undefined;
            });

            expect(accountFollowedEvent).toBeDefined();
            expect(accountFollowedEvent?.getAccountId()).toBe(account.id);
            expect(accountFollowedEvent?.getFollowerId()).toBe(follower.id);
        });

        it('should not emit an account.followed event if the follow is not recorded due to being a duplicate', async () => {
            vi.useFakeTimers();

            let eventCount = 0;

            events.on(AccountFollowedEvent.getName(), () => {
                eventCount++;
            });

            const account = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'account',
            });
            const follower = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'follower',
            });

            await service.recordAccountFollow(account, follower);
            await service.recordAccountFollow(account, follower);

            await vi.advanceTimersByTime(1000);

            expect(eventCount).toBe(1);
        });
    });

    describe('getAccountByApId', () => {
        it('should retrieve an account by its ActivityPub ID', async () => {
            const account = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'account',
            });

            const retrievedAccount = await service.getAccountByApId(
                account.ap_id,
            );

            // Assert the retrieved account matches the created account
            expect(retrievedAccount).toMatchObject(account);
        });
    });

    describe('getDefaultAccountForSite', () => {
        it('should retrieve the default account for a site', async () => {
            const account = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'account',
            });

            const defaultAccount = await service.getDefaultAccountForSite(site);

            expect(defaultAccount).toMatchObject(account);
        });

        it('should throw an error if multiple users are found for a site', async () => {
            await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'account1',
            });
            await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'account2',
            });

            await expect(
                service.getDefaultAccountForSite(site),
            ).rejects.toThrow(`Multiple users found for site: ${site.id}`);
        });

        it('should throw an error if no users are found for a site', async () => {
            await expect(
                service.getDefaultAccountForSite(site),
            ).rejects.toThrow(`No user found for site: ${site.id}`);
        });

        it('should throw an error if no account is found for a site user', async () => {
            await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'account',
            });

            const rows = await db('users')
                .select('account_id')
                .where({ site_id: site.id });

            await db('accounts').where({ id: rows[0].account_id }).del();

            await expect(
                service.getDefaultAccountForSite(site),
            ).rejects.toThrow();
        });
    });

    describe('getFollowingAccounts', () => {
        it('should retrieve the accounts that an account follows', async () => {
            const account = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'account',
            });
            const following1 = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'following1',
            });
            const following2 = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'following2',
            });
            const following3 = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'following3',
            });

            await service.recordAccountFollow(following1, account);
            await service.recordAccountFollow(following2, account);
            await service.recordAccountFollow(following3, account);

            // Get a page of following accounts and assert the requested fields are returned
            const followingAccounts = await service.getFollowingAccounts(
                account,
                {
                    limit: 2,
                    offset: 0,
                    fields: ['id', 'username', 'ap_inbox_url'],
                },
            );

            expect(followingAccounts).toHaveLength(2);
            expect(followingAccounts[0]).toMatchObject({
                id: following3.id,
                username: following3.username,
            });
            expect(followingAccounts[0].ap_inbox_url).toBeDefined();

            expect(followingAccounts[1]).toMatchObject({
                id: following2.id,
                username: following2.username,
            });
            expect(followingAccounts[1].ap_inbox_url).toBeDefined();

            // Get the next page of following accounts and assert the requested fields are returned
            const nextFollowingAccounts = await service.getFollowingAccounts(
                account,
                {
                    limit: 2,
                    offset: 2,
                    fields: ['id', 'username', 'ap_inbox_url'],
                },
            );

            expect(nextFollowingAccounts).toHaveLength(1);
            expect(nextFollowingAccounts[0]).toMatchObject({
                id: following1.id,
                username: following1.username,
            });
            expect(nextFollowingAccounts[0].ap_inbox_url).toBeDefined();

            // Get another page that will return no results and assert the
            // results are empty
            const nextFollowingAccountsEmpty =
                await service.getFollowingAccounts(account, {
                    limit: 2,
                    offset: 3,
                    fields: ['id', 'username', 'ap_inbox_url'],
                });

            expect(nextFollowingAccountsEmpty).toHaveLength(0);
        });
    });

    describe('getFollowingAccountsCount', () => {
        it('should retrieve the number of accounts that an account follows', async () => {
            const account = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'account',
            });
            const following1 = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'following1',
            });
            const following2 = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'following2',
            });

            await service.recordAccountFollow(following1, account);
            await service.recordAccountFollow(following2, account);

            const count = await service.getFollowingAccountsCount(account.id);

            expect(count).toBe(2);
        });
    });

    describe('getFollowerAccounts', () => {
        it('should retrieve the accounts that are following an account', async () => {
            const account = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'account',
            });
            const follower1 = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'follower1',
            });
            const follower2 = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'follower2',
            });
            const follower3 = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'follower3',
            });

            await service.recordAccountFollow(account, follower1);
            await service.recordAccountFollow(account, follower2);
            await service.recordAccountFollow(account, follower3);

            // Get a page of followers and assert the requested fields are returned
            const followers = await service.getFollowerAccounts(account, {
                limit: 2,
                offset: 0,
                fields: ['id', 'username', 'ap_inbox_url'],
            });

            expect(followers).toHaveLength(2);
            expect(followers[0]).toMatchObject({
                id: follower3.id,
                username: follower3.username,
            });
            expect(followers[0].ap_inbox_url).toBeDefined();

            expect(followers[1]).toMatchObject({
                id: follower2.id,
                username: follower2.username,
            });
            expect(followers[1].ap_inbox_url).toBeDefined();

            // Get the next page of followers and assert the requested fields are returned
            const nextFollowers = await service.getFollowerAccounts(account, {
                limit: 2,
                offset: 2,
                fields: ['id', 'username', 'ap_inbox_url'],
            });

            expect(nextFollowers).toHaveLength(1);
            expect(nextFollowers[0]).toMatchObject({
                id: follower1.id,
                username: follower1.username,
            });
            expect(nextFollowers[0].ap_inbox_url).toBeDefined();

            // Get another page that will return no results and assert the
            // results are empty
            const nextFollowersEmpty = await service.getFollowerAccounts(
                account,
                {
                    limit: 2,
                    offset: 3,
                    fields: ['id', 'username', 'ap_inbox_url'],
                },
            );

            expect(nextFollowersEmpty).toHaveLength(0);
        });
    });

    describe('getFollowerAccountsCount', () => {
        it('should retrieve the number of accounts that are following an account', async () => {
            const account = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'account',
            });
            const follower1 = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'follower1',
            });
            const follower2 = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'follower2',
            });

            await service.recordAccountFollow(account, follower1);
            await service.recordAccountFollow(account, follower2);

            const count = await service.getFollowerAccountsCount(account.id);

            expect(count).toBe(2);
        });
    });

    describe('checkIfAccountIsFollowing', () => {
        it('should check if an account is following another account', async () => {
            const account = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'account',
            });
            const followee = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'followee',
            });
            const nonFollowee = await service.createInternalAccount(site, {
                ...internalAccountData,
                username: 'non-followee',
            });

            await service.recordAccountFollow(followee, account);

            const isFollowing = await service.checkIfAccountIsFollowing(
                account.id,
                followee.id,
            );

            expect(isFollowing).toBe(true);

            const isNotFollowing = await service.checkIfAccountIsFollowing(
                account.id,
                nonFollowee.id,
            );

            expect(isNotFollowing).toBe(false);
        });
    });

    describe('ensureByApId', () => {
        it('should create an account when it does not exist', async () => {
            const apId = new URL(
                'https://example.com/activitypub/users/testuser',
            );

            let account = await db('accounts').where({ ap_id: apId.href });
            expect(account).toHaveLength(0);

            const result = await service.ensureByApId(apId);

            expect(isError(result)).toBe(false);
            if (!isError(result)) {
                const account = getValue(result);
                expect(account.apId.href).toBe(apId.href);
                expect(account.username).toBe('testuser');
                expect(account.name).toBe('Test User');
            }

            account = await db('accounts').where({ ap_id: apId.href });
            expect(account).toHaveLength(1);
        });

        it('should handle if account URL is passes as input ID', async () => {
            const inputUrl = new URL('https://example.com/users/testuser');
            const actualActorId = mockActor.id;

            const result = await service.ensureByApId(inputUrl);

            expect(lookupObject).toHaveBeenCalledWith(
                inputUrl,
                expect.any(Object),
            );

            expect(isError(result)).toBe(false);
            if (!isError(result)) {
                const account = getValue(result);
                expect(account.apId.href).toBe(actualActorId.href);
            }
        });

        it('should return error when actor is not found', async () => {
            const apId = new URL(
                'https://example.com/activitypub/users/nonexistent',
            );

            vi.mocked(lookupObject).mockResolvedValue(null);

            const result = await service.ensureByApId(apId);

            expect(isError(result)).toBe(true);
            if (isError(result)) {
                expect(getError(result)).toBe('not-found');
            }
        });

        it('should return error when object is not an actor', async () => {
            const apId = new URL(
                'https://example.com/activitypub/users/notanactor',
            );
            const mockObject = {
                type: 'Note',
                content: 'This is not an actor',
            };

            vi.mocked(lookupObject).mockResolvedValue(
                mockObject as unknown as Note,
            );
            vi.mocked(isActor).mockReturnValue(false);

            const result = await service.ensureByApId(apId);

            expect(isError(result)).toBe(true);
            if (isError(result)) {
                expect(getError(result)).toBe('invalid-type');
            }
        });
    });
});
