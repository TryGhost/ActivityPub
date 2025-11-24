import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Knex } from 'knex';

import { AccountSearchView } from '@/http/api/views/account.search.view';
import { createTestDb } from '@/test/db';
import { createFixtureManager, type FixtureManager } from '@/test/fixtures';

describe('AccountSearchView', () => {
    let db: Knex;
    let fixtureManager: FixtureManager;
    let accountSearchView: AccountSearchView;

    beforeAll(async () => {
        db = await createTestDb();
        fixtureManager = await createFixtureManager(db);
    });

    beforeEach(async () => {
        await fixtureManager.reset();

        accountSearchView = new AccountSearchView(db);
    });

    afterAll(async () => {
        await db.destroy();
    });

    describe('searchByName', () => {
        it('should return empty array for query with no matches', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();

            await fixtureManager.createInternalAccount();

            const accounts = await accountSearchView.searchByName(
                'foo',
                viewer.id,
            );

            expect(accounts).toHaveLength(0);
        });

        it('should return accounts matching query in name field (contains)', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();

            await db('accounts').insert([
                {
                    ap_id: 'https://example.com/users/alice',
                    username: 'alice',
                    domain: 'example.com',
                    ap_inbox_url: 'https://example.com/users/alice/inbox',
                    name: 'Alice Smith',
                },
                {
                    ap_id: 'https://example.com/users/bob',
                    username: 'bob',
                    domain: 'example.com',
                    ap_inbox_url: 'https://example.com/users/bob/inbox',
                    name: 'Bob Johnson',
                },
                {
                    ap_id: 'https://example.com/users/charlie',
                    username: 'charlie',
                    domain: 'example.com',
                    ap_inbox_url: 'https://example.com/users/charlie/inbox',
                    name: 'Charlie Smith',
                },
            ]);

            const accounts = await accountSearchView.searchByName(
                'Smith',
                viewer.id,
            );

            expect(accounts).toHaveLength(2);
            expect(accounts.map((a) => a.name)).toContain('Alice Smith');
            expect(accounts.map((a) => a.name)).toContain('Charlie Smith');
        });

        it('should match query anywhere in name field', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();

            await db('accounts').insert({
                ap_id: 'https://example.com/users/alice',
                username: 'alice',
                domain: 'example.com',
                ap_inbox_url: 'https://example.com/users/alice/inbox',
                name: 'Alice Smith',
            });

            const queries = ['alice', 'smith', 'ali', 'ith', 'ce smi'];

            for (const query of queries) {
                const accounts = await accountSearchView.searchByName(
                    query,
                    viewer.id,
                );

                expect(accounts).toHaveLength(1);
                expect(accounts[0].name).toBe('Alice Smith');
            }
        });

        it('should be case-insensitive', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();

            await db('accounts').insert({
                ap_id: 'https://example.com/users/alice',
                username: 'alice',
                domain: 'example.com',
                ap_inbox_url: 'https://example.com/users/alice/inbox',
                name: 'Alice Smith',
            });

            const queries = ['alice', 'Alice', 'ALICE', 'aLice'];

            for (const query of queries) {
                const accounts = await accountSearchView.searchByName(
                    query,
                    viewer.id,
                );

                expect(accounts).toHaveLength(1);
                expect(accounts[0].name).toBe('Alice Smith');
            }
        });

        it('should return expected fields for accounts', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();
            const [account] = await fixtureManager.createInternalAccount();

            const accounts = await accountSearchView.searchByName(
                account.name!,
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
            expect(accounts[0].followerCount).toBe(0);
            expect(accounts[0].followedByMe).toBe(false);
            expect(accounts[0].blockedByMe).toBe(false);
            expect(accounts[0].domainBlockedByMe).toBe(false);
        });

        it('should filter out blocked accounts', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();
            const [accountOne] = await fixtureManager.createInternalAccount();
            const [accountTwo] = await fixtureManager.createInternalAccount();
            const [blockedAccount] =
                await fixtureManager.createInternalAccount();

            await db('accounts')
                .where('id', accountOne.id)
                .update({ name: 'Test Account One' });

            await db('accounts')
                .where('id', accountTwo.id)
                .update({ name: 'Test Account Two' });

            await db('accounts')
                .where('id', blockedAccount.id)
                .update({ name: 'Test Account Three' });

            await fixtureManager.createBlock(viewer, blockedAccount);

            const accounts = await accountSearchView.searchByName(
                'Test Account',
                viewer.id,
            );

            expect(accounts).toHaveLength(2);
            expect(accounts.map((a) => a.id)).toContain(
                accountOne.apId.toString(),
            );
            expect(accounts.map((a) => a.id)).toContain(
                accountTwo.apId.toString(),
            );
        });

        it('should filter out domain-blocked accounts', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();
            const [accountOne] = await fixtureManager.createInternalAccount();
            const externalAccount = await fixtureManager.createExternalAccount(
                'https://blocked-domain.com/',
            );

            await db('accounts')
                .where('id', accountOne.id)
                .update({ name: 'Test Account One' });

            await db('accounts')
                .where('id', externalAccount.id)
                .update({ name: 'Test Account Two' });

            await fixtureManager.createDomainBlock(
                viewer,
                new URL('https://blocked-domain.com'),
            );

            const accounts = await accountSearchView.searchByName(
                'Test Account',
                viewer.id,
            );

            expect(accounts).toHaveLength(1);
            expect(accounts[0].id).toBe(accountOne.apId.toString());
        });

        it('should filter out the viewer account', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();
            const [accountOne] = await fixtureManager.createInternalAccount();
            const [accountTwo] = await fixtureManager.createInternalAccount();

            await db('accounts')
                .where('id', viewer.id)
                .update({ name: 'Test Account Viewer' });

            await db('accounts')
                .where('id', accountOne.id)
                .update({ name: 'Test Account One' });

            await db('accounts')
                .where('id', accountTwo.id)
                .update({ name: 'Test Account Two' });

            const accounts = await accountSearchView.searchByName(
                'Test Account',
                viewer.id,
            );

            expect(accounts).toHaveLength(2);
            expect(accounts.map((a) => a.id)).toContain(
                accountOne.apId.toString(),
            );
            expect(accounts.map((a) => a.id)).toContain(
                accountTwo.apId.toString(),
            );
        });

        it('should set followedByMe field correctly', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();
            const [followedAccount] =
                await fixtureManager.createInternalAccount();
            const [notFollowedAccount] =
                await fixtureManager.createInternalAccount();

            await db('accounts')
                .where('id', followedAccount.id)
                .update({ name: 'Test Account One' });

            await db('accounts')
                .where('id', notFollowedAccount.id)
                .update({ name: 'Test Account Two' });

            await fixtureManager.createFollow(viewer, followedAccount);

            const accounts = await accountSearchView.searchByName(
                'Test Account',
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
        });

        it('should escape SQL wildcards in query', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();

            await db('accounts').insert([
                {
                    ap_id: 'https://example.com/users/alice',
                    username: 'alice',
                    domain: 'example.com',
                    ap_inbox_url: 'https://example.com/users/alice/inbox',
                    name: 'Test_Account',
                },
                {
                    ap_id: 'https://example.com/users/bob',
                    username: 'bob',
                    domain: 'example.com',
                    ap_inbox_url: 'https://example.com/users/bob/inbox',
                    name: 'TestXAccount',
                },
            ]);

            const accounts = await accountSearchView.searchByName(
                'Test_',
                viewer.id,
            );

            expect(accounts).toHaveLength(1);
            expect(accounts[0].name).toBe('Test_Account');
            expect(accounts[0].name).not.toBe('TestXAccount');
        });

        it('should sort results alphabetically by name', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();

            await db('accounts').insert([
                {
                    ap_id: 'https://example.com/users/charlie',
                    username: 'charlie',
                    domain: 'example.com',
                    ap_inbox_url: 'https://example.com/users/charlie/inbox',
                    name: 'Charlie Test',
                },
                {
                    ap_id: 'https://example.com/users/alice',
                    username: 'alice',
                    domain: 'example.com',
                    ap_inbox_url: 'https://example.com/users/alice/inbox',
                    name: 'Alice Test',
                },
                {
                    ap_id: 'https://example.com/users/bob',
                    username: 'bob',
                    domain: 'example.com',
                    ap_inbox_url: 'https://example.com/users/bob/inbox',
                    name: 'Bob Test',
                },
            ]);

            const accounts = await accountSearchView.searchByName(
                'Test',
                viewer.id,
            );

            expect(accounts).toHaveLength(3);
            expect(accounts[0].name).toBe('Alice Test');
            expect(accounts[1].name).toBe('Bob Test');
            expect(accounts[2].name).toBe('Charlie Test');
        });

        it('should limit results to maximum', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();

            // Create 25 accounts
            for (let i = 0; i < 25; i++) {
                await db('accounts').insert({
                    ap_id: `https://example.com/users/user_${i}`,
                    username: `user_${i}`,
                    domain: 'example.com',
                    ap_inbox_url: `https://example.com/users/user_${i}/inbox`,
                    name: `Test Account ${i.toString().padStart(2, '0')}`,
                });
            }

            // Should return maximum of 20 results
            const accounts = await accountSearchView.searchByName(
                'Test Account',
                viewer.id,
            );

            expect(accounts).toHaveLength(20);
        });

        it('should handle empty name field gracefully', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();

            await db('accounts').insert({
                ap_id: 'https://example.com/users/alice',
                username: 'alice',
                domain: 'example.com',
                ap_inbox_url: 'https://example.com/users/alice/inbox',
                name: null,
            });

            const accounts = await accountSearchView.searchByName(
                'alice',
                viewer.id,
            );

            expect(accounts).toHaveLength(0);
        });
    });
});
