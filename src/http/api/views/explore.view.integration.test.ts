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

        it('should filter out the viewer account', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();
            const [accountOne] = await fixtureManager.createInternalAccount();
            const [accountTwo] = await fixtureManager.createInternalAccount();

            const topic = await fixtureManager.createTopic('Art', 'art');

            await fixtureManager.addAccountToTopic(viewer.id, topic.id);
            await fixtureManager.addAccountToTopic(accountOne.id, topic.id);
            await fixtureManager.addAccountToTopic(accountTwo.id, topic.id);

            const { accounts, next } = await exploreView.getAccountsInTopic(
                topic.slug,
                viewer.id,
            );

            expect(accounts).toHaveLength(2);
            expect(accounts.map((a) => a.id)).not.toContain(
                viewer.apId.toString(),
            );
            expect(accounts.map((a) => a.id)).toContain(
                accountOne.apId.toString(),
            );
            expect(accounts.map((a) => a.id)).toContain(
                accountTwo.apId.toString(),
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
