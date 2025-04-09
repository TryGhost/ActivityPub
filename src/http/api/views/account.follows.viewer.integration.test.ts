import { AsyncEvents } from 'core/events';
import type { Knex } from 'knex';
import { generateTestCryptoKeyPair } from 'test/crypto-key-pair';
import { createTestDb } from 'test/db';
import {
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { KnexAccountRepository } from '../../../account/account.repository.knex';
import { AccountService } from '../../../account/account.service';
import type { InternalAccountData, Site } from '../../../account/types';
import { FedifyContextFactory } from '../../../activitypub/fedify-context.factory';
import { AccountFollowsViewer } from './account.follows.viewer';

vi.mock('@fedify/fedify', async () => {
    const actual = await vi.importActual('@fedify/fedify');
    return {
        ...actual,
    };
});

describe('AccountFollowsViewer', () => {
    let viewer: AccountFollowsViewer;
    let accountService: AccountService;
    let events: AsyncEvents;
    let site: Site;
    let internalAccountData: InternalAccountData;
    let db: Knex;

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
            avatar_url: 'https://example.com/avatar.jpg',
        };

        // Init dependencies
        events = new AsyncEvents();
        const accountRepository = new KnexAccountRepository(db, events);
        const fedifyContextFactory = new FedifyContextFactory();

        // Create the services
        accountService = new AccountService(
            db,
            events,
            accountRepository,
            fedifyContextFactory,
            generateTestCryptoKeyPair,
        );

        viewer = new AccountFollowsViewer(db, fedifyContextFactory);
    });

    describe('getFollowingAccounts', () => {
        it('should retrieve accounts that the provided account is following', async () => {
            // Create accounts
            const account = await accountService.createInternalAccount(site, {
                ...internalAccountData,
                username: 'account',
            });
            const following1 = await accountService.createInternalAccount(
                site,
                {
                    ...internalAccountData,
                    username: 'following1',
                },
            );
            const following2 = await accountService.createInternalAccount(
                site,
                {
                    ...internalAccountData,
                    username: 'following2',
                },
            );
            const following3 = await accountService.createInternalAccount(
                site,
                {
                    ...internalAccountData,
                    username: 'following3',
                },
            );

            // Set up follows
            await accountService.recordAccountFollow(following1, account);
            await accountService.recordAccountFollow(following2, account);
            await accountService.recordAccountFollow(following3, account);

            // Get following accounts
            const results = await viewer.getFollowingAccounts(
                account.id,
                10,
                0,
            );

            // Assert results
            expect(results).toHaveLength(3);

            // Check order (most recent first)
            expect(results[0].id).toBe(following3.id);
            expect(results[1].id).toBe(following2.id);
            expect(results[2].id).toBe(following1.id);

            // Check account details
            expect(results[0].name).toBe(following3.name);
            expect(results[0].username).toBe(following3.username);
            expect(results[0].ap_id).toBe(following3.ap_id);
            expect(results[0].avatar_url).toBe(following3.avatar_url);
        });

        it('should handle pagination', async () => {
            // Create accounts
            const account = await accountService.createInternalAccount(site, {
                ...internalAccountData,
                username: 'account',
            });

            // Create 5 following accounts
            const followingAccounts = [];
            for (let i = 0; i < 5; i++) {
                const following = await accountService.createInternalAccount(
                    site,
                    {
                        ...internalAccountData,
                        username: `following${i}`,
                    },
                );
                followingAccounts.push(following);
                await accountService.recordAccountFollow(following, account);
            }

            // Get first page (limit 2)
            const firstPage = await viewer.getFollowingAccounts(
                account.id,
                2,
                0,
            );
            expect(firstPage).toHaveLength(2);
            expect(firstPage[0].id).toBe(followingAccounts[4].id);
            expect(firstPage[1].id).toBe(followingAccounts[3].id);

            // Get second page
            const secondPage = await viewer.getFollowingAccounts(
                account.id,
                2,
                2,
            );
            expect(secondPage).toHaveLength(2);
            expect(secondPage[0].id).toBe(followingAccounts[2].id);
            expect(secondPage[1].id).toBe(followingAccounts[1].id);

            // Get third page
            const thirdPage = await viewer.getFollowingAccounts(
                account.id,
                2,
                4,
            );
            expect(thirdPage).toHaveLength(1);
            expect(thirdPage[0].id).toBe(followingAccounts[0].id);
        });
    });

    describe('getFollowerAccounts', () => {
        it('should retrieve accounts that are following the provided account', async () => {
            // Create accounts
            const account = await accountService.createInternalAccount(site, {
                ...internalAccountData,
                username: 'account',
            });
            const follower1 = await accountService.createInternalAccount(site, {
                ...internalAccountData,
                username: 'follower1',
            });
            const follower2 = await accountService.createInternalAccount(site, {
                ...internalAccountData,
                username: 'follower2',
            });
            const follower3 = await accountService.createInternalAccount(site, {
                ...internalAccountData,
                username: 'follower3',
            });

            // Set up follows
            await accountService.recordAccountFollow(account, follower1);
            await accountService.recordAccountFollow(account, follower2);
            await accountService.recordAccountFollow(account, follower3);

            // Get follower accounts
            const results = await viewer.getFollowerAccounts(account.id, 10, 0);

            // Assert results
            expect(results).toHaveLength(3);

            // Check order (most recent first)
            expect(results[0].id).toBe(follower3.id);
            expect(results[1].id).toBe(follower2.id);
            expect(results[2].id).toBe(follower1.id);

            // Check account details
            expect(results[0].name).toBe(follower3.name);
            expect(results[0].username).toBe(follower3.username);
            expect(results[0].ap_id).toBe(follower3.ap_id);
            expect(results[0].avatar_url).toBe(follower3.avatar_url);
        });

        it('should handle pagination', async () => {
            // Create accounts
            const account = await accountService.createInternalAccount(site, {
                ...internalAccountData,
                username: 'account',
            });

            // Create 5 follower accounts
            const followerAccounts = [];
            for (let i = 0; i < 5; i++) {
                const follower = await accountService.createInternalAccount(
                    site,
                    {
                        ...internalAccountData,
                        username: `follower${i}`,
                    },
                );
                followerAccounts.push(follower);
                await accountService.recordAccountFollow(account, follower);
            }

            // Get first page (limit 2)
            const firstPage = await viewer.getFollowerAccounts(
                account.id,
                2,
                0,
            );
            expect(firstPage).toHaveLength(2);
            expect(firstPage[0].id).toBe(followerAccounts[4].id);
            expect(firstPage[1].id).toBe(followerAccounts[3].id);

            // Get second page
            const secondPage = await viewer.getFollowerAccounts(
                account.id,
                2,
                2,
            );
            expect(secondPage).toHaveLength(2);
            expect(secondPage[0].id).toBe(followerAccounts[2].id);
            expect(secondPage[1].id).toBe(followerAccounts[1].id);

            // Get third page
            const thirdPage = await viewer.getFollowerAccounts(
                account.id,
                2,
                4,
            );
            expect(thirdPage).toHaveLength(1);
            expect(thirdPage[0].id).toBe(followerAccounts[0].id);
        });
    });

    describe('getFollowingAccountsCount', () => {
        it('should return the number of accounts that the provided account is following', async () => {
            // Create accounts
            const account = await accountService.createInternalAccount(site, {
                ...internalAccountData,
                username: 'account',
            });
            const following1 = await accountService.createInternalAccount(
                site,
                {
                    ...internalAccountData,
                    username: 'following1',
                },
            );
            const following2 = await accountService.createInternalAccount(
                site,
                {
                    ...internalAccountData,
                    username: 'following2',
                },
            );
            const following3 = await accountService.createInternalAccount(
                site,
                {
                    ...internalAccountData,
                    username: 'following3',
                },
            );

            // Set up follows
            await accountService.recordAccountFollow(following1, account);
            await accountService.recordAccountFollow(following2, account);
            await accountService.recordAccountFollow(following3, account);

            // Get count
            const count = await viewer.getFollowingAccountsCount(account.id);

            expect(count).toBe(3);
        });

        it('should return 0 if accountId is null', async () => {
            const count = await viewer.getFollowingAccountsCount(null);
            expect(count).toBe(0);
        });
    });

    describe('getFollowerAccountsCount', () => {
        it('should return the number of accounts that are following the provided account', async () => {
            // Create accounts
            const account = await accountService.createInternalAccount(site, {
                ...internalAccountData,
                username: 'account',
            });
            const follower1 = await accountService.createInternalAccount(site, {
                ...internalAccountData,
                username: 'follower1',
            });
            const follower2 = await accountService.createInternalAccount(site, {
                ...internalAccountData,
                username: 'follower2',
            });
            const follower3 = await accountService.createInternalAccount(site, {
                ...internalAccountData,
                username: 'follower3',
            });

            // Set up follows
            await accountService.recordAccountFollow(account, follower1);
            await accountService.recordAccountFollow(account, follower2);
            await accountService.recordAccountFollow(account, follower3);

            // Get count
            const count = await viewer.getFollowerAccountsCount(account.id);

            expect(count).toBe(3);
        });

        it('should return 0 if accountId is null', async () => {
            const count = await viewer.getFollowerAccountsCount(null);
            expect(count).toBe(0);
        });
    });

    describe('checkIfAccountIsFollowing', () => {
        it('should return true if an account is following another account', async () => {
            // Create accounts
            const account = await accountService.createInternalAccount(site, {
                ...internalAccountData,
                username: 'account',
            });
            const followee = await accountService.createInternalAccount(site, {
                ...internalAccountData,
                username: 'followee',
            });

            // Set up follow
            await accountService.recordAccountFollow(followee, account);

            // Check if following
            const isFollowing = await viewer.checkIfAccountIsFollowing(
                account.id,
                followee.id,
            );

            expect(isFollowing).toBe(true);
        });

        it('should return false if an account is not following another account', async () => {
            // Create accounts
            const account = await accountService.createInternalAccount(site, {
                ...internalAccountData,
                username: 'account',
            });
            const nonFollowee = await accountService.createInternalAccount(
                site,
                {
                    ...internalAccountData,
                    username: 'non-followee',
                },
            );

            // Check if following
            const isFollowing = await viewer.checkIfAccountIsFollowing(
                account.id,
                nonFollowee.id,
            );

            expect(isFollowing).toBe(false);
        });

        it('should return false if accountId is null', async () => {
            const isFollowing = await viewer.checkIfAccountIsFollowing(null, 1);
            expect(isFollowing).toBe(false);
        });

        it('should return false if followeeAccountId is null', async () => {
            const isFollowing = await viewer.checkIfAccountIsFollowing(1, null);
            expect(isFollowing).toBe(false);
        });
    });
});
