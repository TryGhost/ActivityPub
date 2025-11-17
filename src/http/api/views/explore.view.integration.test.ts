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

    async function createTopic(name: string, slug: string) {
        const [id] = await db('topics').insert({ name, slug });
        return { id, name, slug };
    }

    async function addAccountToTopic(accountId: number, topicId: number) {
        await db('account_topics').insert({
            account_id: accountId,
            topic_id: topicId,
        });
    }

    describe('getAccountsInTopic', () => {
        it('should filter out blocked accounts', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();
            const [accountOne] = await fixtureManager.createInternalAccount();
            const [accountTwo] = await fixtureManager.createInternalAccount();
            const [blockedAccount] =
                await fixtureManager.createInternalAccount();

            const topic = await createTopic('Technology', 'technology');

            await addAccountToTopic(accountOne.id, topic.id);
            await addAccountToTopic(accountTwo.id, topic.id);
            await addAccountToTopic(blockedAccount.id, topic.id);

            // Viewer blocks one account
            await fixtureManager.createBlock(viewer, blockedAccount);

            const { accounts, next } = await exploreView.getAccountsInTopic(
                topic.slug,
                viewer.id,
            );

            expect(accounts).toHaveLength(2);
            expect(accounts.map((a) => a.apId)).toContain(
                accountOne.apId.toString(),
            );
            expect(accounts.map((a) => a.apId)).toContain(
                accountTwo.apId.toString(),
            );
            expect(accounts.map((a) => a.apId)).not.toContain(
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

            const topic = await createTopic('Science', 'science');

            await addAccountToTopic(accountOne.id, topic.id);
            await addAccountToTopic(externalAccount.id, topic.id);

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
            expect(accounts[0].apId).toBe(accountOne.apId.toString());
            expect(accounts.map((a) => a.apId)).not.toContain(
                externalAccount.apId.toString(),
            );
            expect(next).toBeNull();
        });

        it('should filter out the viewer account', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();
            const [accountOne] = await fixtureManager.createInternalAccount();
            const [accountTwo] = await fixtureManager.createInternalAccount();

            const topic = await createTopic('Art', 'art');

            await addAccountToTopic(viewer.id, topic.id);
            await addAccountToTopic(accountOne.id, topic.id);
            await addAccountToTopic(accountTwo.id, topic.id);

            const { accounts, next } = await exploreView.getAccountsInTopic(
                topic.slug,
                viewer.id,
            );

            expect(accounts).toHaveLength(2);
            expect(accounts.map((a) => a.apId)).not.toContain(
                viewer.apId.toString(),
            );
            expect(accounts.map((a) => a.apId)).toContain(
                accountOne.apId.toString(),
            );
            expect(accounts.map((a) => a.apId)).toContain(
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

            const topic = await createTopic('Music', 'music');

            await addAccountToTopic(followedAccount.id, topic.id);
            await addAccountToTopic(notFollowedAccount.id, topic.id);

            // Viewer follows one account
            await fixtureManager.createFollow(viewer, followedAccount);

            const { accounts, next } = await exploreView.getAccountsInTopic(
                topic.slug,
                viewer.id,
            );

            expect(accounts).toHaveLength(2);

            const followedAccountDTO = accounts.find(
                (a) => a.apId === followedAccount.apId.toString(),
            );
            const notFollowedAccountDTO = accounts.find(
                (a) => a.apId === notFollowedAccount.apId.toString(),
            );

            expect(followedAccountDTO?.followedByMe).toBe(true);
            expect(notFollowedAccountDTO?.followedByMe).toBe(false);
            expect(next).toBeNull();
        });

        it('should paginate results correctly', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();
            const topic = await createTopic('Gaming', 'gaming');

            // Create 25 accounts in the topic
            const accounts: Account[] = [];
            for (let i = 0; i < 25; i++) {
                const [account] = await fixtureManager.createInternalAccount();
                accounts.push(account);
                await addAccountToTopic(account.id, topic.id);
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
            const firstPageIds = firstPage.accounts.map((a) => a.apId);
            const secondPageIds = secondPage.accounts.map((a) => a.apId);

            const overlap = firstPageIds.filter((id) =>
                secondPageIds.includes(id),
            );
            expect(overlap).toHaveLength(0);

            // Verify all accounts are included across both pages
            const allReturnedIds = [...firstPageIds, ...secondPageIds];
            expect(allReturnedIds).toHaveLength(25);
        });

        it('should return empty array for non-existent topic', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();

            const { accounts, next } = await exploreView.getAccountsInTopic(
                'non-existent-topic',
                viewer.id,
            );

            expect(accounts).toHaveLength(0);
            expect(next).toBeNull();
        });
    });
});
