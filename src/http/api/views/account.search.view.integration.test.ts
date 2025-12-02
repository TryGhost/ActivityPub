import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

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

        it('should return empty array for empty query', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();

            await db('accounts').insert({
                ap_id: 'https://example.com/users/alice',
                username: 'alice',
                domain: 'example.com',
                ap_inbox_url: 'https://example.com/users/alice/inbox',
                name: 'Alice Smith',
            });

            const accounts = await accountSearchView.searchByName(
                '',
                viewer.id,
            );

            expect(accounts).toHaveLength(0);
        });

        it('should return empty array for whitespace-only query', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();

            await db('accounts').insert({
                ap_id: 'https://example.com/users/alice',
                username: 'alice',
                domain: 'example.com',
                ap_inbox_url: 'https://example.com/users/alice/inbox',
                name: 'Alice Smith',
            });

            const whitespaceQueries = ['   ', '\t', '\n', '  \t\n  '];

            for (const query of whitespaceQueries) {
                const accounts = await accountSearchView.searchByName(
                    query,
                    viewer.id,
                );

                expect(accounts).toHaveLength(0);
            }
        });

        it('should return accounts with a name starting with the query', async () => {
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
                    name: 'Charlie Alice',
                },
            ]);

            const accounts = await accountSearchView.searchByName(
                'Alice',
                viewer.id,
            );

            expect(accounts).toHaveLength(1);
            expect(accounts.map((a) => a.name)).toContain('Alice Smith');
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

            const queries = ['alice', 'Alice', 'ALICE', 'aLice', 'ALI'];

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

        it('should escape SQL wildcards in query (underscore)', async () => {
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
        });

        it('should escape SQL wildcards in query (percent)', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();

            await db('accounts').insert([
                {
                    ap_id: 'https://example.com/users/alice',
                    username: 'alice',
                    domain: 'example.com',
                    ap_inbox_url: 'https://example.com/users/alice/inbox',
                    name: 'Test%Account',
                },
                {
                    ap_id: 'https://example.com/users/bob',
                    username: 'bob',
                    domain: 'example.com',
                    ap_inbox_url: 'https://example.com/users/bob/inbox',
                    name: 'TestAnything',
                },
            ]);

            const accounts = await accountSearchView.searchByName(
                'Test%',
                viewer.id,
            );

            expect(accounts).toHaveLength(1);
            expect(accounts[0].name).toBe('Test%Account');
        });

        it('should escape SQL wildcards in query (backslash)', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();

            await db('accounts').insert([
                {
                    ap_id: 'https://example.com/users/alice',
                    username: 'alice',
                    domain: 'example.com',
                    ap_inbox_url: 'https://example.com/users/alice/inbox',
                    name: 'Test\\Account',
                },
                {
                    ap_id: 'https://example.com/users/bob',
                    username: 'bob',
                    domain: 'example.com',
                    ap_inbox_url: 'https://example.com/users/bob/inbox',
                    name: 'TestAccount',
                },
            ]);

            const accounts = await accountSearchView.searchByName(
                'Test\\',
                viewer.id,
            );

            expect(accounts).toHaveLength(1);
            expect(accounts[0].name).toBe('Test\\Account');
        });

        it('should sort results alphabetically by name', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();

            await db('accounts').insert([
                {
                    ap_id: 'https://example.com/users/charlie',
                    username: 'charlie',
                    domain: 'example.com',
                    ap_inbox_url: 'https://example.com/users/charlie/inbox',
                    name: 'Test Charlie',
                },
                {
                    ap_id: 'https://example.com/users/alice',
                    username: 'alice',
                    domain: 'example.com',
                    ap_inbox_url: 'https://example.com/users/alice/inbox',
                    name: 'Test Alice',
                },
                {
                    ap_id: 'https://example.com/users/bob',
                    username: 'bob',
                    domain: 'example.com',
                    ap_inbox_url: 'https://example.com/users/bob/inbox',
                    name: 'Test Bob',
                },
            ]);

            const accounts = await accountSearchView.searchByName(
                'Test',
                viewer.id,
            );

            expect(accounts).toHaveLength(3);
            expect(accounts[0].name).toBe('Test Alice');
            expect(accounts[1].name).toBe('Test Bob');
            expect(accounts[2].name).toBe('Test Charlie');
        });

        it('should prioritize Ghost sites (internal accounts) over external accounts', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();

            // Create an internal account (Ghost site) - has user record
            // Use a name starting with Z to ensure alphabetical sort would put it last
            const [ghostSite] = await fixtureManager.createInternalAccount();

            await db('accounts')
                .where('id', ghostSite.id)
                .update({ name: 'Test Zebra Ghost Site' });

            // Create external accounts - no user record
            // Use names starting with A and B to ensure alphabetical sort would put them first
            await db('accounts').insert([
                {
                    ap_id: 'https://example.com/users/alice',
                    username: 'alice',
                    domain: 'example.com',
                    ap_inbox_url: 'https://example.com/users/alice/inbox',
                    name: 'Test Alice External',
                },
                {
                    ap_id: 'https://example.com/users/bob',
                    username: 'bob',
                    domain: 'example.com',
                    ap_inbox_url: 'https://example.com/users/bob/inbox',
                    name: 'Test Bob External',
                },
            ]);

            const accounts = await accountSearchView.searchByName(
                'Test',
                viewer.id,
            );

            expect(accounts).toHaveLength(3);
            // Ghost site should appear first despite having name starting with Z
            expect(accounts[0].name).toBe('Test Zebra Ghost Site');
            // External accounts should be sorted alphabetically after Ghost sites
            expect(accounts[1].name).toBe('Test Alice External');
            expect(accounts[2].name).toBe('Test Bob External');
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

    describe('searchByDomain', () => {
        it('should return expected fields for accounts', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();
            const [account] = await fixtureManager.createInternalAccount();

            const domain = new URL(account.apId.toString()).hostname;

            const accounts = await accountSearchView.searchByDomain(
                domain,
                viewer.id,
            );

            expect(accounts.length).toBeGreaterThan(0);
            const result = accounts.find(
                (a) => a.id === account.apId.toString(),
            );

            expect(result).toBeDefined();
            expect(result!.id).toBe(account.apId.toString());
            expect(result!.name).toBe(account.name);
            expect(result!.handle).toBe(
                `@${account.username}@${account.apId.host}`,
            );
            expect(result!.avatarUrl).toBe(
                account.avatarUrl ? account.avatarUrl.toString() : null,
            );
            expect(result!.followerCount).toBeGreaterThanOrEqual(0);
            expect(result!.followedByMe).toBe(false);
            expect(result!.blockedByMe).toBe(false);
            expect(result!.domainBlockedByMe).toBe(false);
        });

        it('should return accounts matching the domain', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();

            await db('accounts').insert([
                {
                    ap_id: 'https://example.com/users/alice',
                    username: 'alice',
                    domain: 'example.com',
                    ap_inbox_url: 'https://example.com/users/alice/inbox',
                    name: 'Alice',
                },
                {
                    ap_id: 'https://example.com/users/bob',
                    username: 'bob',
                    domain: 'example.com',
                    ap_inbox_url: 'https://example.com/users/bob/inbox',
                    name: 'Bob',
                },
                {
                    ap_id: 'https://other.com/users/charlie',
                    username: 'charlie',
                    domain: 'other.com',
                    ap_inbox_url: 'https://other.com/users/charlie/inbox',
                    name: 'Charlie',
                },
            ]);

            const accounts = await accountSearchView.searchByDomain(
                'example.com',
                viewer.id,
            );

            expect(accounts).toHaveLength(2);
            expect(accounts.map((a) => a.handle)).toContain(
                '@alice@example.com',
            );
            expect(accounts.map((a) => a.handle)).toContain('@bob@example.com');
        });

        it('should be case-insensitive for domain matching', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();

            await db('accounts').insert({
                ap_id: 'https://example.com/users/alice',
                username: 'alice',
                domain: 'example.com',
                ap_inbox_url: 'https://example.com/users/alice/inbox',
                name: 'Alice',
            });

            // Test various case combinations
            const queries = [
                'example.com',
                'Example.com',
                'EXAMPLE.COM',
                'ExAmPlE.CoM',
            ];

            for (const query of queries) {
                const accounts = await accountSearchView.searchByDomain(
                    query,
                    viewer.id,
                );

                expect(accounts).toHaveLength(1);
                expect(accounts[0].handle).toBe('@alice@example.com');
            }
        });

        it('should return empty array when no accounts match the domain', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();

            await db('accounts').insert({
                ap_id: 'https://example.com/users/alice',
                username: 'alice',
                domain: 'example.com',
                ap_inbox_url: 'https://example.com/users/alice/inbox',
                name: 'Alice',
            });

            const accounts = await accountSearchView.searchByDomain(
                'nonexistent.com',
                viewer.id,
            );

            expect(accounts).toHaveLength(0);
        });

        it('should filter out the viewer account', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();

            const viewerDomain = new URL(viewer.apId.toString()).hostname;

            // Create another account on the same domain as the viewer
            await db('accounts').insert({
                ap_id: `https://${viewerDomain}/users/other`,
                username: 'other',
                domain: viewerDomain,
                ap_inbox_url: `https://${viewerDomain}/users/other/inbox`,
                name: 'Other Account',
            });

            const accounts = await accountSearchView.searchByDomain(
                viewerDomain,
                viewer.id,
            );

            // Should only return the other account, not the viewer
            expect(accounts.map((a) => a.id)).not.toContain(
                viewer.apId.toString(),
            );
            expect(accounts.length).toBeGreaterThan(0);
            expect(
                accounts.some((a) => a.handle === `@other@${viewerDomain}`),
            ).toBe(true);
        });

        it('should filter out blocked accounts', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();

            await db('accounts').insert([
                {
                    ap_id: 'https://example.com/users/alice',
                    username: 'alice',
                    domain: 'example.com',
                    ap_inbox_url: 'https://example.com/users/alice/inbox',
                    name: 'Alice',
                },
                {
                    ap_id: 'https://example.com/users/bob',
                    username: 'bob',
                    domain: 'example.com',
                    ap_inbox_url: 'https://example.com/users/bob/inbox',
                    name: 'Bob',
                },
            ]);

            const [blockedAccount] = await db('accounts')
                .where('username', 'bob')
                .select('*');

            await fixtureManager.createBlock(viewer, blockedAccount);

            const accounts = await accountSearchView.searchByDomain(
                'example.com',
                viewer.id,
            );

            expect(accounts).toHaveLength(1);
            expect(accounts[0].handle).toBe('@alice@example.com');
        });

        it('should filter out domain-blocked accounts', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();

            await db('accounts').insert([
                {
                    ap_id: 'https://blocked-domain.com/users/alice',
                    username: 'alice',
                    domain: 'blocked-domain.com',
                    ap_inbox_url:
                        'https://blocked-domain.com/users/alice/inbox',
                    name: 'Alice',
                },
                {
                    ap_id: 'https://blocked-domain.com/users/bob',
                    username: 'bob',
                    domain: 'blocked-domain.com',
                    ap_inbox_url: 'https://blocked-domain.com/users/bob/inbox',
                    name: 'Bob',
                },
            ]);

            await fixtureManager.createDomainBlock(
                viewer,
                new URL('https://blocked-domain.com'),
            );

            const accounts = await accountSearchView.searchByDomain(
                'blocked-domain.com',
                viewer.id,
            );

            expect(accounts).toHaveLength(0);
        });

        it('should set followedByMe field correctly', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();

            await db('accounts').insert([
                {
                    ap_id: 'https://example.com/users/alice',
                    username: 'alice',
                    domain: 'example.com',
                    ap_inbox_url: 'https://example.com/users/alice/inbox',
                    name: 'Alice',
                },
                {
                    ap_id: 'https://example.com/users/bob',
                    username: 'bob',
                    domain: 'example.com',
                    ap_inbox_url: 'https://example.com/users/bob/inbox',
                    name: 'Bob',
                },
            ]);

            const [followedAccount] = await db('accounts')
                .where('username', 'alice')
                .select('*');

            await fixtureManager.createFollow(viewer, followedAccount);

            const accounts = await accountSearchView.searchByDomain(
                'example.com',
                viewer.id,
            );

            expect(accounts).toHaveLength(2);

            const aliceAccount = accounts.find(
                (a) => a.handle === '@alice@example.com',
            );
            const bobAccount = accounts.find(
                (a) => a.handle === '@bob@example.com',
            );

            expect(aliceAccount?.followedByMe).toBe(true);
            expect(bobAccount?.followedByMe).toBe(false);
        });

        it('should respect the limit parameter', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();

            // Create 5 accounts on the same domain
            for (let i = 0; i < 5; i++) {
                await db('accounts').insert({
                    ap_id: `https://example.com/users/user_${i}`,
                    username: `user_${i}`,
                    domain: 'example.com',
                    ap_inbox_url: `https://example.com/users/user_${i}/inbox`,
                    name: `User ${i}`,
                });
            }

            const accounts = await accountSearchView.searchByDomain(
                'example.com',
                viewer.id,
                2, // Limit to 2 results
            );

            expect(accounts).toHaveLength(2);
        });

        it('should use default limit when not specified', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();

            // Create 25 accounts on the same domain
            for (let i = 0; i < 25; i++) {
                await db('accounts').insert({
                    ap_id: `https://example.com/users/user_${i}`,
                    username: `user_${i}`,
                    domain: 'example.com',
                    ap_inbox_url: `https://example.com/users/user_${i}/inbox`,
                    name: `User ${i}`,
                });
            }

            const accounts = await accountSearchView.searchByDomain(
                'example.com',
                viewer.id,
                // No limit specified, should use default (20)
            );

            // Should return maximum of 20 results (SEARCH_RESULT_LIMIT)
            expect(accounts).toHaveLength(20);
        });

        it('should handle subdomains correctly', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();

            await db('accounts').insert([
                {
                    ap_id: 'https://example.com/users/alice',
                    username: 'alice',
                    domain: 'example.com',
                    ap_inbox_url: 'https://example.com/users/alice/inbox',
                    name: 'Alice',
                },
                {
                    ap_id: 'https://subdomain.example.com/users/bob',
                    username: 'bob',
                    domain: 'subdomain.example.com',
                    ap_inbox_url:
                        'https://subdomain.example.com/users/bob/inbox',
                    name: 'Bob',
                },
            ]);

            // Searching for example.com should not match subdomain.example.com
            const accounts = await accountSearchView.searchByDomain(
                'example.com',
                viewer.id,
            );

            expect(accounts).toHaveLength(1);
            expect(accounts[0].handle).toBe('@alice@example.com');
        });

        it('should prioritize Ghost sites (internal accounts) over external accounts', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();

            // Create an internal account (Ghost site)
            // Use a name starting with Z to ensure alphabetical sort would put it last
            const [ghostSite] = await fixtureManager.createInternalAccount();
            await db('accounts')
                .where('id', ghostSite.id)
                .update({ name: 'Zebra Ghost Site' });

            const ghostSiteDomain = new URL(ghostSite.apId.toString()).hostname;

            // Create external accounts on the same domain as the ghost site - no user record
            // Use names starting with A and B to ensure alphabetical sort would put them first
            await db('accounts').insert([
                {
                    ap_id: `https://${ghostSiteDomain}/users/alice`,
                    username: 'alice',
                    domain: ghostSiteDomain,
                    ap_inbox_url: `https://${ghostSiteDomain}/users/alice/inbox`,
                    name: 'Alice External',
                },
                {
                    ap_id: `https://${ghostSiteDomain}/users/bob`,
                    username: 'bob',
                    domain: ghostSiteDomain,
                    ap_inbox_url: `https://${ghostSiteDomain}/users/bob/inbox`,
                    name: 'Bob External',
                },
            ]);

            const accounts = await accountSearchView.searchByDomain(
                ghostSiteDomain,
                viewer.id,
            );

            // Should have 3 accounts (ghostSite + 2 external)
            expect(accounts).toHaveLength(3);
            // Ghost site should appear first despite having name starting with Z
            expect(accounts[0].name).toBe('Zebra Ghost Site');
            // External accounts should be sorted alphabetically after Ghost sites
            expect(accounts[1].name).toBe('Alice External');
            expect(accounts[2].name).toBe('Bob External');
        });
    });
});
