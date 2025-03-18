import { KnexAccountRepository } from 'account/account.repository.knex';
import { AccountService } from 'account/account.service';
import { AsyncEvents } from 'core/events';
import type { Knex } from 'knex';
import { generateTestCryptoKeyPair } from 'test/crypto-key-pair';
import { createTestDb } from 'test/db';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FedifyContextFactory } from './fedify-context.factory';
import { FollowersService } from './followers.service';

describe('FollowersService', () => {
    let client: Knex;
    let service: FollowersService;
    let accountRepository: KnexAccountRepository;
    let accountService: AccountService;

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
        });
        beforeEach(async () => {
            await client.raw('SET FOREIGN_KEY_CHECKS = 0');
            await client('follows').truncate();
            await client('accounts').truncate();
            await client('users').truncate();
            await client('sites').truncate();
            await client.raw('SET FOREIGN_KEY_CHECKS = 1');
        });
        it('Can get all followers, handling missing data', async () => {
            const siteData = {
                host: 'example.com',
                webhook_secret: 'secret',
            };

            const [id] = await client('sites').insert(siteData);

            const site = {
                id,
                ...siteData,
            };

            const internalAccountData = {
                username: 'index',
                name: 'Test Site Title',
                bio: 'Test Site Description',
                avatar_url: 'Test Site Icon',
            };
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

            await accountService.recordAccountFollow(account, follower1);
            await accountService.recordAccountFollow(account, follower2);
            await accountService.recordAccountFollow(account, follower3);

            const followers = await service.getFollowers(account.id);

            expect(followers).toHaveLength(3);
            expect(followers).toMatchObject([
                {
                    id: new URL(
                        'https://example.com/.ghost/activitypub/users/follower3',
                    ),
                    inboxId: new URL(
                        'https://example.com/.ghost/activitypub/inbox/follower3',
                    ),
                    endpoints: {
                        sharedInbox: null,
                    },
                },
                {
                    id: new URL(
                        'https://example.com/.ghost/activitypub/users/follower2',
                    ),
                    inboxId: new URL(
                        'https://example.com/.ghost/activitypub/inbox/follower2',
                    ),
                    endpoints: {
                        sharedInbox: null,
                    },
                },
                {
                    id: new URL(
                        'https://example.com/.ghost/activitypub/users/follower1',
                    ),
                    inboxId: new URL(
                        'https://example.com/.ghost/activitypub/inbox/follower1',
                    ),
                    endpoints: {
                        sharedInbox: null,
                    },
                },
            ]);
        });
    });
});
