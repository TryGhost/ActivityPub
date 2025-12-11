import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Knex } from 'knex';

import type { Account } from '@/account/account.entity';
import { AccountSearchView } from '@/http/api/views/account.search.view';
import { createTestDb } from '@/test/db';
import { createFixtureManager, type FixtureManager } from '@/test/fixtures';

const searchAccountsFixture = JSON.parse(
    readFileSync(
        join(__dirname, '../../../test/fixtures/search-accounts.json'),
        'utf-8',
    ),
) as Array<{ name: string; username: string; domain: string }>;

describe('AccountSearchView', () => {
    let db: Knex;
    let fixtureManager: FixtureManager;
    let accountSearchView: AccountSearchView;
    let viewerAccount: Account;

    beforeAll(async () => {
        db = await createTestDb();
        fixtureManager = await createFixtureManager(db);
    });

    beforeEach(async () => {
        await fixtureManager.reset();

        for (const account of searchAccountsFixture) {
            await db('accounts').insert({
                ap_id: `https://${account.domain}/users/${account.username}`,
                username: account.username,
                domain: account.domain,
                ap_inbox_url: `https://${account.domain}/inbox/${account.username}`,
                name: account.name,
            });
        }

        accountSearchView = new AccountSearchView(db);

        [viewerAccount] = await fixtureManager.createInternalAccount();
    });

    describe('search', () => {
        it('should return empty array for query with no matches', async () => {
            const accounts = await accountSearchView.search(
                'foobar', // There are no fixtures containing "foobar"
                viewerAccount.id,
            );

            expect(accounts).toHaveLength(0);
        });

        it('should return empty array for empty query', async () => {
            const accounts = await accountSearchView.search(
                '',
                viewerAccount.id,
            );

            expect(accounts).toHaveLength(0);
        });

        it('should return empty array for whitespace-only query', async () => {
            const whitespaceQueries = ['   ', '\t', '\n', '  \t\n  '];

            for (const query of whitespaceQueries) {
                const accounts = await accountSearchView.search(
                    query,
                    viewerAccount.id,
                );

                expect(accounts).toHaveLength(0);
            }
        });

        it('should return accounts with a name containing the query', async () => {
            // Fixtures contain "Coding Horror" and "Troy Hunt"
            const accounts = await accountSearchView.search(
                'Horror',
                viewerAccount.id,
            );

            expect(accounts).toHaveLength(1);
            expect(accounts[0].name).toBe('Coding Horror');
        });

        it('should be case-insensitive', async () => {
            // Fixtures contain "Troy Hunt"
            const queries = ['troy', 'Troy', 'TROY', 'tRoy', 'TRO'];

            for (const query of queries) {
                const accounts = await accountSearchView.search(
                    query,
                    viewerAccount.id,
                );

                expect(accounts).toHaveLength(1);
                expect(accounts[0].name).toBe('Troy Hunt');
            }
        });

        it('should trim whitespace from query', async () => {
            // Fixtures contain "Troy Hunt"
            const queries = [' troy', 'troy ', ' troy ', '  troy  '];

            for (const query of queries) {
                const accounts = await accountSearchView.search(
                    query,
                    viewerAccount.id,
                );

                expect(accounts).toHaveLength(1);
                expect(accounts[0].name).toBe('Troy Hunt');
            }
        });

        it('should return expected fields for accounts', async () => {
            // Fixtures contain "Coding Horror"
            const accounts = await accountSearchView.search(
                'Coding Horror',
                viewerAccount.id,
            );

            expect(accounts).toHaveLength(1);
            expect(accounts[0].id).toBe(
                'https://blog.codinghorror.com/users/index',
            );
            expect(accounts[0].name).toBe('Coding Horror');
            expect(accounts[0].handle).toBe('@index@blog.codinghorror.com');
            expect(accounts[0].avatarUrl).toBeNull();
            expect(accounts[0].followedByMe).toBe(false);
            expect(accounts[0].blockedByMe).toBe(false);
            expect(accounts[0].domainBlockedByMe).toBe(false);
        });

        it('should filter out blocked accounts', async () => {
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

            await fixtureManager.createBlock(viewerAccount, blockedAccount);

            const accounts = await accountSearchView.search(
                'Test Account',
                viewerAccount.id,
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
                viewerAccount,
                new URL('https://blocked-domain.com'),
            );

            const accounts = await accountSearchView.search(
                'Test Account',
                viewerAccount.id,
            );

            expect(accounts).toHaveLength(1);
            expect(accounts[0].id).toBe(accountOne.apId.toString());
        });

        it('should set followedByMe field correctly', async () => {
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

            await fixtureManager.createFollow(viewerAccount, followedAccount);

            const accounts = await accountSearchView.search(
                'Test Account',
                viewerAccount.id,
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
            await db('accounts').insert([
                {
                    ap_id: 'https://example.com/users/alice',
                    username: 'alice',
                    domain: 'example.com',
                    ap_inbox_url: 'https://example.com/users/alice/inbox',
                    name: 'Example_Account',
                },
                {
                    ap_id: 'https://example.com/users/bob',
                    username: 'bob',
                    domain: 'example.com',
                    ap_inbox_url: 'https://example.com/users/bob/inbox',
                    name: 'ExampleXAccount',
                },
            ]);

            const accounts = await accountSearchView.search(
                'Example_',
                viewerAccount.id,
            );

            expect(accounts).toHaveLength(1);
            expect(accounts[0].name).toBe('Example_Account');
        });

        it('should sort results alphabetically by name', async () => {
            // Fixtures contain multiple "The ..." accounts that should be sorted alphabetically
            // "The Bell", "The Berkeley Scanner", "The Browser", etc.
            const accounts = await accountSearchView.search(
                'The Browser',
                viewerAccount.id,
            );

            expect(accounts.length).toBeGreaterThanOrEqual(1);
            expect(accounts[0].name).toBe('The Browser');
        });

        it('should prioritize Ghost sites (internal accounts) over external accounts', async () => {
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

            const accounts = await accountSearchView.search(
                'Test',
                viewerAccount.id,
            );

            expect(accounts).toHaveLength(3);
            // Ghost site should appear first despite having name starting with Z
            expect(accounts[0].name).toBe('Test Zebra Ghost Site');
            // External accounts should be sorted alphabetically after Ghost sites
            expect(accounts[1].name).toBe('Test Alice External');
            expect(accounts[2].name).toBe('Test Bob External');
        });

        it('should limit results to maximum', async () => {
            // Fixtures contain 34 accounts with "Blog" in their name
            const accounts = await accountSearchView.search(
                'Blog',
                viewerAccount.id,
            );

            // Should return maximum of 20 results
            expect(accounts).toHaveLength(20);
        });

        it('should handle empty name field gracefully but still match by handle', async () => {
            await db('accounts').insert({
                ap_id: 'https://example.com/users/alice',
                username: 'alice',
                domain: 'example.com',
                ap_inbox_url: 'https://example.com/users/alice/inbox',
                name: null,
            });

            // Searching for the handle should still find the account
            const accounts = await accountSearchView.search(
                '@alice@example.com',
                viewerAccount.id,
            );

            expect(accounts).toHaveLength(1);
            expect(accounts[0].handle).toBe('@alice@example.com');
        });

        it('should return accounts matching by handle', async () => {
            // Fixtures contain "John O'Nolan" with username "john" on domain "john.onolan.org"
            const accounts = await accountSearchView.search(
                '@john',
                viewerAccount.id,
            );

            expect(accounts.length).toBeGreaterThanOrEqual(1);
            expect(accounts[0].handle).toBe('@john@john.onolan.org');
        });

        it('should return accounts matching by partial handle', async () => {
            // Fixture contains "John O'Nolan" with username "john" on domain "john.onolan.org"
            const accounts = await accountSearchView.search(
                'john@john.onolan',
                viewerAccount.id,
            );

            expect(accounts.length).toBeGreaterThanOrEqual(1);
            expect(accounts[0].handle).toBe('@john@john.onolan.org');
        });

        it('should return accounts matching by domain', async () => {
            // Fixtures contain account on domain "blog.codinghorror.com"
            const accounts = await accountSearchView.search(
                'codinghorror',
                viewerAccount.id,
            );

            expect(accounts.length).toBeGreaterThanOrEqual(1);
            expect(accounts[0].name).toBe('Coding Horror');
        });

        it('should return accounts matching by partial domain', async () => {
            // Fixtures contain account on domain "blog.codinghorror.com"
            // Searching "codinghorror" should match by domain
            const accounts = await accountSearchView.search(
                'codinghorror',
                viewerAccount.id,
            );

            expect(accounts).toHaveLength(1);
            expect(accounts[0].handle).toBe('@index@blog.codinghorror.com');
        });

        it('should rank name "starts with" matches higher than "contains" matches', async () => {
            // Fixtures contain "Platformer" and "Product Marketing Alliance"
            // Searching "Platform" should prioritize "Platformer" (starts with)
            const accounts = await accountSearchView.search(
                'Platform',
                viewerAccount.id,
            );

            expect(accounts.length).toBeGreaterThanOrEqual(1);
            // "Platformer" should come first (name starts with "Platform")
            expect(accounts[0].name).toBe('Platformer');
        });

        it('should rank name matches higher than handle matches', async () => {
            // Fixtures contain "John O'Nolan" with username "john"
            // Searching "john" should match name first
            const accounts = await accountSearchView.search(
                'Nolan',
                viewerAccount.id,
            );

            expect(accounts.length).toBeGreaterThanOrEqual(1);
            // Name match should come first
            expect(accounts[0].name).toBe("John O'Nolan");
        });

        it('should rank handle "starts with" matches higher than "contains" matches', async () => {
            // Fixtures contain "John O'Nolan" with @john@john.onolan.org
            // Searching for "@john" should prioritize the handle match
            const accounts = await accountSearchView.search(
                '@john',
                viewerAccount.id,
            );

            expect(accounts.length).toBeGreaterThanOrEqual(1);
            // @john@john.onolan.org should match "handle starts with @john"
            expect(accounts[0].handle).toBe('@john@john.onolan.org');
        });

        it('should return accounts from multiple match types with proper ranking', async () => {
            // Fixtures contain multiple "News" accounts:
            // - "Arete News", "Atlas News", "EIR News" etc (name contains "News")
            const accounts = await accountSearchView.search(
                'News',
                viewerAccount.id,
            );

            expect(accounts.length).toBeGreaterThan(5);

            // Results should be ranked by:
            // 0. Name starts with "News" (if any)
            // 1. Name contains "News"
            // Then sorted alphabetically within each rank

            // Verify accounts with name containing "News" are sorted alphabetically
            const newsAccounts = accounts.filter(
                (a) =>
                    a.name?.toLowerCase().includes('news') &&
                    !a.name?.toLowerCase().startsWith('news'),
            );

            for (let i = 1; i < newsAccounts.length; i++) {
                const prev = newsAccounts[i - 1].name || '';
                const curr = newsAccounts[i].name || '';

                expect(prev.localeCompare(curr)).toBeLessThanOrEqual(0);
            }
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
