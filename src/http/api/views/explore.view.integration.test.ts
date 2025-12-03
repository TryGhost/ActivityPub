import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Knex } from 'knex';

import type { Account } from '@/account/account.entity';
import { ExploreView } from '@/http/api/views/explore.view';
import { createTestDb } from '@/test/db';
import { createFixtureManager, type FixtureManager } from '@/test/fixtures';

describe('ExploreView', () => {
    let db: Knex;
    let fixtureManager: FixtureManager;
    let exploreView: ExploreView;

    beforeAll(async () => {
        db = await createTestDb();
        fixtureManager = await createFixtureManager(db);
    });

    beforeEach(async () => {
        await fixtureManager.reset();
        exploreView = new ExploreView(db);
    });

    afterAll(async () => {
        await db.destroy();
    });

    describe('getAccountsInTopic', () => {
        it('should return empty array for non-existent topic', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();

            const { accounts, next } = await exploreView.getAccountsInTopic(
                'non-existent-topic',
                viewer.id,
            );

            expect(accounts).toHaveLength(0);
            expect(next).toBeNull();
        });

        it('should return expected fields for accounts', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();
            const [account] = await fixtureManager.createInternalAccount();

            const topic = await fixtureManager.createTopic(
                'Technology',
                'technology',
            );
            await fixtureManager.addAccountToTopic(account.id, topic.id);

            const { accounts } = await exploreView.getAccountsInTopic(
                topic.slug,
                viewer.id,
            );

            expect(accounts).toHaveLength(1);
            expect(accounts[0].id).toBe(account.apId.toString());
            expect(accounts[0].name).toBe(account.name);
            expect(accounts[0].handle).toBe(
                `@${account.username}@${account.apId.host}`,
            );
            expect(accounts[0].avatarUrl).toBe(
                account.avatarUrl ? account.avatarUrl.toString() : null,
            );
            expect(accounts[0].bio).toBe(account.bio);
            expect(accounts[0].url).toBe(
                account.url ? account.url.toString() : null,
            );
            expect(accounts[0].followedByMe).toBe(false);
        });

        it('should sanitize HTML in bio field', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();

            const bioWithHtml =
                '<p>Hello <strong>world</strong>!</p><script>alert("xss")</script><img src=x onerror="alert(1)">';

            const [accountId] = await db('accounts').insert({
                ap_id: 'https://example.com/users/testuser',
                username: 'testuser',
                domain: 'example.com',
                ap_inbox_url: 'https://example.com/users/testuser/inbox',
                name: 'Test User',
                bio: bioWithHtml,
            });

            const topic = await fixtureManager.createTopic('Tech', 'tech');
            await fixtureManager.addAccountToTopic(accountId, topic.id);

            const { accounts } = await exploreView.getAccountsInTopic(
                topic.slug,
                viewer.id,
            );

            expect(accounts).toHaveLength(1);

            // Bio should have allowed HTML preserved
            expect(accounts[0].bio).toContain('<p>');
            expect(accounts[0].bio).toContain('<strong>');
            expect(accounts[0].bio).toContain('Hello');
            expect(accounts[0].bio).toContain('world');

            // Dangerous content inside script tags should be removed
            expect(accounts[0].bio).not.toContain('alert("xss")');

            // Event handlers should be removed
            expect(accounts[0].bio).not.toContain('onerror');
            expect(accounts[0].bio).not.toContain('alert(1)');
        });

        it('should filter out blocked accounts', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();
            const [accountOne] = await fixtureManager.createInternalAccount();
            const [accountTwo] = await fixtureManager.createInternalAccount();
            const [blockedAccount] =
                await fixtureManager.createInternalAccount();

            const topic = await fixtureManager.createTopic('News', 'news');

            await fixtureManager.addAccountToTopic(accountOne.id, topic.id);
            await fixtureManager.addAccountToTopic(accountTwo.id, topic.id);
            await fixtureManager.addAccountToTopic(blockedAccount.id, topic.id);

            // Viewer blocks one account
            await fixtureManager.createBlock(viewer, blockedAccount);

            const { accounts, next } = await exploreView.getAccountsInTopic(
                topic.slug,
                viewer.id,
            );

            expect(accounts).toHaveLength(2);
            expect(accounts.map((a) => a.id)).toContain(
                accountOne.apId.toString(),
            );
            expect(accounts.map((a) => a.id)).toContain(
                accountTwo.apId.toString(),
            );
            expect(accounts.map((a) => a.id)).not.toContain(
                blockedAccount.apId.toString(),
            );
            expect(next).toBeNull();
        });

        it('should filter out domain-blocked accounts', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();
            const [accountOne] = await fixtureManager.createInternalAccount();
            const externalAccount = await fixtureManager.createExternalAccount(
                'https://blocked-domain.com/',
            );

            const topic = await fixtureManager.createTopic(
                'Science',
                'science',
            );

            await fixtureManager.addAccountToTopic(accountOne.id, topic.id);
            await fixtureManager.addAccountToTopic(
                externalAccount.id,
                topic.id,
            );

            // Viewer blocks the external domain
            await fixtureManager.createDomainBlock(
                viewer,
                new URL('https://blocked-domain.com'),
            );

            const { accounts, next } = await exploreView.getAccountsInTopic(
                topic.slug,
                viewer.id,
            );

            expect(accounts).toHaveLength(1);
            expect(accounts[0].id).toBe(accountOne.apId.toString());
            expect(accounts.map((a) => a.id)).not.toContain(
                externalAccount.apId.toString(),
            );
            expect(next).toBeNull();
        });

        it('should set followedByMe field correctly', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();
            const [followedAccount] =
                await fixtureManager.createInternalAccount();
            const [notFollowedAccount] =
                await fixtureManager.createInternalAccount();

            const topic = await fixtureManager.createTopic('Music', 'music');

            await fixtureManager.addAccountToTopic(
                followedAccount.id,
                topic.id,
            );
            await fixtureManager.addAccountToTopic(
                notFollowedAccount.id,
                topic.id,
            );

            // Viewer follows one account
            await fixtureManager.createFollow(viewer, followedAccount);

            const { accounts, next } = await exploreView.getAccountsInTopic(
                topic.slug,
                viewer.id,
            );

            expect(accounts).toHaveLength(2);

            const followedAccountDTO = accounts.find(
                (a) => a.id === followedAccount.apId.toString(),
            );
            const notFollowedAccountDTO = accounts.find(
                (a) => a.id === notFollowedAccount.apId.toString(),
            );

            expect(followedAccountDTO?.followedByMe).toBe(true);
            expect(notFollowedAccountDTO?.followedByMe).toBe(false);
            expect(next).toBeNull();
        });

        it('should sort by accounts.id when rank_in_topic is not set (defaults to 0)', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();
            const topic = await fixtureManager.createTopic('Sports', 'sports');

            const [account1] = await fixtureManager.createInternalAccount();
            const [account2] = await fixtureManager.createInternalAccount();
            const [account3] = await fixtureManager.createInternalAccount();

            // Add accounts to topic without specifying rank (defaults to 0)
            await fixtureManager.addAccountToTopic(account1.id, topic.id);
            await fixtureManager.addAccountToTopic(account2.id, topic.id);
            await fixtureManager.addAccountToTopic(account3.id, topic.id);

            const { accounts } = await exploreView.getAccountsInTopic(
                topic.slug,
                viewer.id,
            );

            expect(accounts).toHaveLength(3);

            // All accounts have rank 0, so they should be sorted by accounts.id
            const sortedAccounts = [account1, account2, account3].sort(
                (a, b) => a.id - b.id,
            );

            expect(accounts[0].id).toBe(sortedAccounts[0].apId.toString());
            expect(accounts[1].id).toBe(sortedAccounts[1].apId.toString());
            expect(accounts[2].id).toBe(sortedAccounts[2].apId.toString());
        });

        it('should sort by rank_in_topic ascending when set', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();
            const topic = await fixtureManager.createTopic(
                'Technology',
                'technology',
            );

            const [accountRank1] = await fixtureManager.createInternalAccount();
            const [accountRank2A] =
                await fixtureManager.createInternalAccount();
            const [accountRank2B] =
                await fixtureManager.createInternalAccount();
            const [accountRank3] = await fixtureManager.createInternalAccount();

            // Add accounts to topic with ranking
            await fixtureManager.addAccountToTopic(
                accountRank1.id,
                topic.id,
                1,
            );
            await fixtureManager.addAccountToTopic(
                accountRank2A.id,
                topic.id,
                2,
            );
            await fixtureManager.addAccountToTopic(
                accountRank2B.id,
                topic.id,
                2,
            );
            await fixtureManager.addAccountToTopic(
                accountRank3.id,
                topic.id,
                3,
            );

            const { accounts } = await exploreView.getAccountsInTopic(
                topic.slug,
                viewer.id,
            );

            expect(accounts).toHaveLength(4);

            // First account should have rank 1
            expect(accounts[0].id).toBe(accountRank1.apId.toString());

            // Second and third accounts should have rank 2, ordered by account id
            const rank2Accounts = [accounts[1], accounts[2]];
            expect(rank2Accounts.map((a) => a.id)).toEqual(
                accountRank2A.id < accountRank2B.id
                    ? [
                          accountRank2A.apId.toString(),
                          accountRank2B.apId.toString(),
                      ]
                    : [
                          accountRank2B.apId.toString(),
                          accountRank2A.apId.toString(),
                      ],
            );

            // Fourth account should have rank 3
            expect(accounts[3].id).toBe(accountRank3.apId.toString());
        });

        it('should paginate results correctly', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();
            const topic = await fixtureManager.createTopic('Gaming', 'gaming');

            // Create 25 accounts in the topic
            const accounts: Account[] = [];
            for (let i = 0; i < 25; i++) {
                const [account] = await fixtureManager.createInternalAccount();
                accounts.push(account);
                await fixtureManager.addAccountToTopic(account.id, topic.id);
            }

            // First page - should return 20 accounts and next cursor
            const firstPage = await exploreView.getAccountsInTopic(
                topic.slug,
                viewer.id,
                0,
                20,
            );

            expect(firstPage.accounts).toHaveLength(20);
            expect(firstPage.next).toBe('20');

            // Second page - should return 5 accounts and null next cursor
            const secondPage = await exploreView.getAccountsInTopic(
                topic.slug,
                viewer.id,
                20,
                20,
            );

            expect(secondPage.accounts).toHaveLength(5);
            expect(secondPage.next).toBeNull();

            // Verify no overlap between pages
            const firstPageIds = firstPage.accounts.map((a) => a.id);
            const secondPageIds = secondPage.accounts.map((a) => a.id);

            const overlap = firstPageIds.filter((id) =>
                secondPageIds.includes(id),
            );
            expect(overlap).toHaveLength(0);

            // Verify all accounts are included across both pages
            const allReturnedIds = [...firstPageIds, ...secondPageIds];
            expect(allReturnedIds).toHaveLength(25);
        });
    });
});
