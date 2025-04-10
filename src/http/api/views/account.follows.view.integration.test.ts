import type { Account } from 'account/account.entity';
import { KnexAccountRepository } from 'account/account.repository.knex';
import { AccountService } from 'account/account.service';
import type {
    Account as AccountType,
    InternalAccountData,
    Site,
} from 'account/types';
import { FedifyContextFactory } from 'activitypub/fedify-context.factory';
import { AsyncEvents } from 'core/events';
import type { Knex } from 'knex';
import { generateTestCryptoKeyPair } from 'test/crypto-key-pair';
import { createTestDb } from 'test/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AccountFollowsView } from './account.follows.view';

describe('AccountFollowsView', () => {
    let viewer: AccountFollowsView;
    let accountService: AccountService;
    let accountRepository: KnexAccountRepository;
    let events: AsyncEvents;
    let site: Site;
    let internalAccountData: InternalAccountData;
    let db: Knex;
    let defaultAccount: AccountType;
    let siteDefaultAccount: Account | null;

    beforeAll(async () => {
        db = await createTestDb();
    });

    beforeEach(async () => {
        // Clean up the database
        await db.raw('SET FOREIGN_KEY_CHECKS = 0');
        await db('follows').truncate();
        await db('accounts').truncate();
        await db('users').truncate();
        await db('sites').truncate();
        await db.raw('SET FOREIGN_KEY_CHECKS = 1');

        const siteData = {
            host: 'www.example.com',
            webhook_secret: 'secret',
        };
        const [id] = await db('sites').insert(siteData);

        site = {
            id,
            ...siteData,
        };

        internalAccountData = {
            username: 'index',
            name: 'Test Site Title',
            bio: 'Test Site Description',
            avatar_url: 'https://example.com/avatar.jpg',
        };

        events = new AsyncEvents();
        accountRepository = new KnexAccountRepository(db, events);
        const fedifyContextFactory = new FedifyContextFactory();

        accountService = new AccountService(
            db,
            events,
            accountRepository,
            fedifyContextFactory,
            generateTestCryptoKeyPair,
        );

        viewer = new AccountFollowsView(db, fedifyContextFactory);

        defaultAccount = await accountService.createInternalAccount(site, {
            ...internalAccountData,
            username: 'default',
        });
        siteDefaultAccount = await accountRepository.getByApId(
            new URL(defaultAccount.ap_id),
        );
    });

    describe('getFollows', () => {
        it('should return following accounts with correct format', async () => {
            const following1 = await accountService.createInternalAccount(
                site,
                {
                    ...internalAccountData,
                    username: 'following1',
                    name: 'Following One',
                },
            );
            const following2 = await accountService.createInternalAccount(
                site,
                {
                    ...internalAccountData,
                    username: 'following2',
                    name: 'Following Two',
                },
            );
            if (!siteDefaultAccount) {
                throw new Error('Site default account not found');
            }

            // Set up follows
            await accountService.recordAccountFollow(
                following1,
                defaultAccount,
            );
            await accountService.recordAccountFollow(
                following2,
                defaultAccount,
            );

            const result = await viewer.getFollows(
                'following',
                siteDefaultAccount,
                0,
            );

            expect(result).toHaveProperty('accounts');
            expect(result).toHaveProperty('total', 2);
            expect(result).toHaveProperty('next', null);

            expect(result.accounts).toHaveLength(2);
            expect(result.accounts[0]).toMatchObject({
                id: String(following2.id),
                name: 'Following Two',
                handle: `@following2@${new URL(following2.ap_id).host}`,
                avatarUrl: following2.avatar_url,
                isFollowing: true,
            });
        });

        it('should return follower accounts with correct format', async () => {
            const follower1 = await accountService.createInternalAccount(site, {
                ...internalAccountData,
                username: 'follower1',
                name: 'Follower One',
            });
            const follower2 = await accountService.createInternalAccount(site, {
                ...internalAccountData,
                username: 'follower2',
                name: 'Follower Two',
            });
            if (!siteDefaultAccount) {
                throw new Error('Site default account not found');
            }

            // Set up follows
            await accountService.recordAccountFollow(defaultAccount, follower1);
            await accountService.recordAccountFollow(defaultAccount, follower2);
            // Make follower2 follow defaultAccount back to test isFollowing
            await accountService.recordAccountFollow(follower2, defaultAccount);

            // Get follows
            const result = await viewer.getFollows(
                'followers',
                siteDefaultAccount,
                0,
            );

            expect(result).toHaveProperty('accounts');
            expect(result).toHaveProperty('total', 2);
            expect(result).toHaveProperty('next', null);

            expect(result.accounts).toHaveLength(2);
            const follower2Result = result.accounts.find(
                (a) => a.id === String(follower2.id),
            );
            expect(follower2Result).toMatchObject({
                name: 'Follower Two',
                handle: `@follower2@${new URL(follower2.ap_id).host}`,
                avatarUrl: follower2.avatar_url,
                isFollowing: true,
            });
            const follower1Result = result.accounts.find(
                (a) => a.id === String(follower1.id),
            );
            expect(follower1Result).toMatchObject({
                name: 'Follower One',
                handle: `@follower1@${new URL(follower1.ap_id).host}`,
                avatarUrl: follower1.avatar_url,
                isFollowing: false,
            });
        });

        it('should handle empty results', async () => {
            if (!siteDefaultAccount) {
                throw new Error('Site default account not found');
            }

            const result = await viewer.getFollows(
                'following',
                siteDefaultAccount,
                0,
            );

            expect(result).toMatchObject({
                accounts: [],
                total: 0,
                next: null,
            });
        });
    });
});
