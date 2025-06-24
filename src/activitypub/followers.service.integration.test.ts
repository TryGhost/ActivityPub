import { KnexAccountRepository } from 'account/account.repository.knex';
import { AccountService } from 'account/account.service';
import { AsyncEvents } from 'core/events';
import type { Knex } from 'knex';
import { generateTestCryptoKeyPair } from 'test/crypto-key-pair';
import { createTestDb } from 'test/db';
import { type FixtureManager, createFixtureManager } from 'test/fixtures';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FedifyContextFactory } from './fedify-context.factory';
import { FollowersService } from './followers.service';

describe('FollowersService', () => {
    let client: Knex;
    let service: FollowersService;
    let accountRepository: KnexAccountRepository;
    let accountService: AccountService;
    let fixtureManager: FixtureManager;

    describe('#getFollowers', () => {
        beforeAll(async () => {
            client = await createTestDb();
            service = new FollowersService(client);
            const events = new AsyncEvents();
            accountRepository = new KnexAccountRepository(client, events);
            accountService = new AccountService(
                client,
                events,
                accountRepository,
                new FedifyContextFactory(),
                generateTestCryptoKeyPair,
            );
            fixtureManager = createFixtureManager(client, events);
        });
        beforeEach(async () => {
            await fixtureManager.reset();
        });
        it('Can get all followers, handling missing data', async () => {
            // Create accounts on different domains to avoid conflicts
            const [account, accountSite] =
                await fixtureManager.createInternalAccount();
            const [follower1] = await fixtureManager.createInternalAccount();
            const [follower2] = await fixtureManager.createInternalAccount();
            const [follower3] = await fixtureManager.createInternalAccount();

            await accountService.recordAccountFollow(account, follower1);
            await accountService.recordAccountFollow(account, follower2);
            await accountService.recordAccountFollow(account, follower3);

            const followers = await service.getFollowers(account.id);

            expect(followers).toHaveLength(3);
            expect(followers[0].id?.href).toContain(follower3.username);
            expect(followers[0].inboxId?.href).toContain(follower3.username);
            expect(followers[1].id?.href).toContain(follower2.username);
            expect(followers[1].inboxId?.href).toContain(follower2.username);
            expect(followers[2].id?.href).toContain(follower1.username);
            expect(followers[2].inboxId?.href).toContain(follower1.username);

            expect(followers[0].endpoints?.sharedInbox).toBe(null);
            expect(followers[1].endpoints?.sharedInbox).toBe(null);
            expect(followers[2].endpoints?.sharedInbox).toBe(null);
        });
    });
});
