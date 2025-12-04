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

    describe('search', () => {
        describe('query parsing', () => {
            it('should return empty array for empty query', async () => {
                const [viewer] = await fixtureManager.createInternalAccount();

                await db('accounts').insert({
                    ap_id: 'https://example.com/users/alice',
                    username: 'alice',
                    domain: 'example.com',
                    ap_inbox_url: 'https://example.com/users/alice/inbox',
                    name: 'Alice Smith',
                    bio: 'Hello world',
                });

                const accounts = await accountSearchView.search('', viewer.id);

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
                    bio: 'Hello world',
                });

                const whitespaceQueries = ['   ', '\t', '\n', '  \t\n  '];

                for (const query of whitespaceQueries) {
                    const accounts = await accountSearchView.search(
                        query,
                        viewer.id,
                    );

                    expect(accounts).toHaveLength(0);
                }
            });

            it('should return empty array for @ only query', async () => {
                const [viewer] = await fixtureManager.createInternalAccount();

                await db('accounts').insert({
                    ap_id: 'https://example.com/users/alice',
                    username: 'alice',
                    domain: 'example.com',
                    ap_inbox_url: 'https://example.com/users/alice/inbox',
                    name: 'Alice Smith',
                    bio: 'Hello world',
                });

                const accounts = await accountSearchView.search('@', viewer.id);

                expect(accounts).toHaveLength(0);
            });

            it('should strip leading @ from query', async () => {
                const [viewer] = await fixtureManager.createInternalAccount();

                await db('accounts').insert({
                    ap_id: 'https://example.com/users/ghost',
                    username: 'ghost',
                    domain: 'example.com',
                    ap_inbox_url: 'https://example.com/users/ghost/inbox',
                    name: 'Ghost Blog',
                    bio: 'A Ghost site',
                });

                const accounts = await accountSearchView.search(
                    '@ghost',
                    viewer.id,
                );

                expect(accounts).toHaveLength(1);
                expect(accounts[0].name).toBe('Ghost Blog');
            });

            it('should strip trailing @ from query', async () => {
                const [viewer] = await fixtureManager.createInternalAccount();

                await db('accounts').insert({
                    ap_id: 'https://example.com/users/ghost',
                    username: 'ghost',
                    domain: 'example.com',
                    ap_inbox_url: 'https://example.com/users/ghost/inbox',
                    name: 'Ghost Blog',
                    bio: 'A Ghost site',
                });

                const accounts = await accountSearchView.search(
                    '@ghost@',
                    viewer.id,
                );

                expect(accounts).toHaveLength(1);
                expect(accounts[0].name).toBe('Ghost Blog');
            });

            it('should strip multiple leading @ from query', async () => {
                const [viewer] = await fixtureManager.createInternalAccount();

                await db('accounts').insert({
                    ap_id: 'https://example.com/users/ghost',
                    username: 'ghost',
                    domain: 'example.com',
                    ap_inbox_url: 'https://example.com/users/ghost/inbox',
                    name: 'Ghost Blog',
                    bio: 'A Ghost site',
                });

                const accounts = await accountSearchView.search(
                    '@@ghost',
                    viewer.id,
                );

                expect(accounts).toHaveLength(1);
                expect(accounts[0].name).toBe('Ghost Blog');
            });

            it('should match accounts with BOTH terms for @user@domain queries', async () => {
                const [viewer] = await fixtureManager.createInternalAccount();

                await db('accounts').insert([
                    {
                        ap_id: 'https://fediverse.example/users/john',
                        username: 'john',
                        domain: 'fediverse.example',
                        ap_inbox_url:
                            'https://fediverse.example/users/john/inbox',
                        name: 'John on Fediverse',
                        bio: 'A john user',
                    },
                    {
                        ap_id: 'https://birdsite.example/users/john',
                        username: 'john',
                        domain: 'birdsite.example',
                        ap_inbox_url:
                            'https://birdsite.example/users/john/inbox',
                        name: 'John on Birdsite',
                        bio: 'A john user',
                    },
                    {
                        ap_id: 'https://fediverse.example/users/alice',
                        username: 'alice',
                        domain: 'fediverse.example',
                        ap_inbox_url:
                            'https://fediverse.example/users/alice/inbox',
                        name: 'Alice on Fediverse',
                        bio: 'An alice user',
                    },
                ]);

                const accounts = await accountSearchView.search(
                    '@john@fedi',
                    viewer.id,
                );

                // Should only return john on fediverse (has both "john" AND "fedi")
                expect(accounts).toHaveLength(1);
                expect(accounts[0].name).toBe('John on Fediverse');
            });

            it('should strip FULLTEXT boolean operators from query', async () => {
                const [viewer] = await fixtureManager.createInternalAccount();

                await db('accounts').insert({
                    ap_id: 'https://example.com/users/cppdeveloper',
                    username: 'cppdeveloper',
                    domain: 'example.com',
                    ap_inbox_url:
                        'https://example.com/users/cppdeveloper/inbox',
                    name: 'C++ Developer',
                    bio: 'Programming expert',
                });

                // "developer++" should have the ++ stripped, leaving "developer"
                const accounts = await accountSearchView.search(
                    'developer++',
                    viewer.id,
                );

                // Should find the account containing "developer"
                expect(accounts).toHaveLength(1);
                expect(accounts[0].name).toBe('C++ Developer');
            });

            it('should return empty results when query contains only special chars', async () => {
                const [viewer] = await fixtureManager.createInternalAccount();

                await db('accounts').insert({
                    ap_id: 'https://example.com/users/alice',
                    username: 'alice',
                    domain: 'example.com',
                    ap_inbox_url: 'https://example.com/users/alice/inbox',
                    name: 'Alice Smith',
                    bio: 'Hello world',
                });

                const accounts = await accountSearchView.search(
                    '***',
                    viewer.id,
                );

                expect(accounts).toHaveLength(0);
            });

            it('should strip quotes from query', async () => {
                const [viewer] = await fixtureManager.createInternalAccount();

                await db('accounts').insert({
                    ap_id: 'https://example.com/users/uniqueaccount',
                    username: 'uniqueaccount',
                    domain: 'example.com',
                    ap_inbox_url:
                        'https://example.com/users/uniqueaccount/inbox',
                    name: 'UniqueAccount',
                    bio: 'A unique account',
                });

                // Quotes should be stripped, searching for "uniqueaccount"
                const accounts = await accountSearchView.search(
                    '"uniqueaccount"',
                    viewer.id,
                );

                expect(accounts).toHaveLength(1);
                expect(accounts[0].name).toBe('UniqueAccount');
            });
        });

        describe('relevance ranking', () => {
            it('should rank name starts-with higher than name contains', async () => {
                const [viewer] = await fixtureManager.createInternalAccount();

                await db('accounts').insert([
                    {
                        ap_id: 'https://example.com/users/ghost_starts',
                        username: 'ghost_starts',
                        domain: 'example.com',
                        ap_inbox_url:
                            'https://example.com/users/ghost_starts/inbox',
                        name: 'Ghost Publishing', // Name STARTS with "Ghost"
                        bio: 'Publishing platform',
                    },
                    {
                        ap_id: 'https://example.com/users/ghost_contains',
                        username: 'ghost_contains',
                        domain: 'example.com',
                        ap_inbox_url:
                            'https://example.com/users/ghost_contains/inbox',
                        name: 'The Ghost Company', // Name CONTAINS "Ghost"
                        bio: 'A company',
                    },
                ]);

                const accounts = await accountSearchView.search(
                    'ghost',
                    viewer.id,
                );

                expect(accounts).toHaveLength(2);
                expect(accounts[0].name).toBe('Ghost Publishing');
                expect(accounts[1].name).toBe('The Ghost Company');
            });

            it('should rank name contains higher than username starts-with', async () => {
                const [viewer] = await fixtureManager.createInternalAccount();

                await db('accounts').insert([
                    {
                        ap_id: 'https://example.com/users/ghost',
                        username: 'ghost', // Username STARTS with "ghost"
                        domain: 'example.com',
                        ap_inbox_url: 'https://example.com/users/ghost/inbox',
                        name: 'Different Name',
                        bio: 'Some bio',
                    },
                    {
                        ap_id: 'https://example.com/users/other',
                        username: 'other',
                        domain: 'example.com',
                        ap_inbox_url: 'https://example.com/users/other/inbox',
                        name: 'The Ghost Company', // Name CONTAINS "ghost"
                        bio: 'A company',
                    },
                ]);

                const accounts = await accountSearchView.search(
                    'ghost',
                    viewer.id,
                );

                expect(accounts).toHaveLength(2);
                expect(accounts[0].name).toBe('The Ghost Company');
                expect(accounts[1].name).toBe('Different Name');
            });

            it('should rank username starts-with higher than username contains', async () => {
                const [viewer] = await fixtureManager.createInternalAccount();

                await db('accounts').insert([
                    {
                        ap_id: 'https://example.com/users/ghostuser',
                        username: 'ghostuser', // Username STARTS with "ghost"
                        domain: 'example.com',
                        ap_inbox_url:
                            'https://example.com/users/ghostuser/inbox',
                        name: 'User A',
                        bio: 'Some bio',
                    },
                    {
                        ap_id: 'https://example.com/users/theghost',
                        username: 'theghost', // Username CONTAINS "ghost" (n-gram finds this)
                        domain: 'example.com',
                        ap_inbox_url:
                            'https://example.com/users/theghost/inbox',
                        name: 'User B',
                        bio: 'Some bio',
                    },
                ]);

                const accounts = await accountSearchView.search(
                    'ghost',
                    viewer.id,
                );

                expect(accounts).toHaveLength(2);
                // Username starts-with (60) > Username contains (50)
                expect(accounts[0].name).toBe('User A');
                expect(accounts[1].name).toBe('User B');
            });

            it('should rank username contains higher than domain starts-with', async () => {
                const [viewer] = await fixtureManager.createInternalAccount();

                await db('accounts').insert([
                    {
                        ap_id: 'https://example.com/users/theghost',
                        username: 'theghost', // Username CONTAINS "ghost" (n-gram finds this)
                        domain: 'example.com',
                        ap_inbox_url:
                            'https://example.com/users/theghost/inbox',
                        name: 'User A',
                        bio: 'Some bio',
                    },
                    {
                        ap_id: 'https://ghost.org/users/alice',
                        username: 'alice',
                        domain: 'ghost.org', // Domain STARTS with "ghost"
                        ap_inbox_url: 'https://ghost.org/users/alice/inbox',
                        name: 'User B',
                        bio: 'Some bio',
                    },
                ]);

                const accounts = await accountSearchView.search(
                    'ghost',
                    viewer.id,
                );

                expect(accounts).toHaveLength(2);
                // Username contains (50) > Domain starts-with (40)
                expect(accounts[0].name).toBe('User A');
                expect(accounts[1].name).toBe('User B');
            });

            it('should find username with embedded search term via n-gram', async () => {
                const [viewer] = await fixtureManager.createInternalAccount();

                await db('accounts').insert({
                    ap_id: 'https://example.com/users/superghost123',
                    username: 'superghost123', // "ghost" is in the middle
                    domain: 'example.com',
                    ap_inbox_url:
                        'https://example.com/users/superghost123/inbox',
                    name: 'Super Ghost User',
                    bio: 'Some bio',
                });

                const accounts = await accountSearchView.search(
                    'ghost',
                    viewer.id,
                );

                expect(accounts).toHaveLength(1);
                expect(accounts[0].handle).toBe('@superghost123@example.com');
            });

            it('should find domain with embedded search term via n-gram', async () => {
                const [viewer] = await fixtureManager.createInternalAccount();

                await db('accounts').insert({
                    ap_id: 'https://myghost.com/users/alice',
                    username: 'alice',
                    domain: 'myghost.com', // "ghost" is embedded (no hyphen)
                    ap_inbox_url: 'https://myghost.com/users/alice/inbox',
                    name: 'Alice',
                    bio: 'Some bio',
                });

                const accounts = await accountSearchView.search(
                    'ghost',
                    viewer.id,
                );

                expect(accounts).toHaveLength(1);
                expect(accounts[0].handle).toBe('@alice@myghost.com');
            });

            it('should rank username starts-with higher than domain starts-with', async () => {
                const [viewer] = await fixtureManager.createInternalAccount();

                await db('accounts').insert([
                    {
                        ap_id: 'https://example.com/users/ghostuser',
                        username: 'ghostuser', // Username STARTS with "ghost"
                        domain: 'example.com',
                        ap_inbox_url:
                            'https://example.com/users/ghostuser/inbox',
                        name: 'User A',
                        bio: 'Some bio',
                    },
                    {
                        ap_id: 'https://ghost.org/users/alice',
                        username: 'alice',
                        domain: 'ghost.org', // Domain STARTS with "ghost"
                        ap_inbox_url: 'https://ghost.org/users/alice/inbox',
                        name: 'User B',
                        bio: 'Some bio',
                    },
                ]);

                const accounts = await accountSearchView.search(
                    'ghost',
                    viewer.id,
                );

                expect(accounts).toHaveLength(2);
                // Username starts-with (60) > Domain starts-with (40)
                expect(accounts[0].name).toBe('User A');
                expect(accounts[1].name).toBe('User B');
            });

            it('should rank domain starts-with higher than domain contains', async () => {
                const [viewer] = await fixtureManager.createInternalAccount();

                await db('accounts').insert([
                    {
                        ap_id: 'https://ghost.org/users/alice',
                        username: 'alice',
                        domain: 'ghost.org', // Domain STARTS with "ghost"
                        ap_inbox_url: 'https://ghost.org/users/alice/inbox',
                        name: 'Alice',
                        bio: 'Some bio',
                    },
                    {
                        ap_id: 'https://my-ghost.com/users/bob',
                        username: 'bob',
                        domain: 'my-ghost.com', // Domain CONTAINS "ghost"
                        ap_inbox_url: 'https://my-ghost.com/users/bob/inbox',
                        name: 'Bob',
                        bio: 'Some bio',
                    },
                ]);

                const accounts = await accountSearchView.search(
                    'ghost',
                    viewer.id,
                );

                expect(accounts).toHaveLength(2);
                expect(accounts[0].name).toBe('Alice');
                expect(accounts[1].name).toBe('Bob');
            });

            it('should rank domain contains higher than bio contains', async () => {
                const [viewer] = await fixtureManager.createInternalAccount();

                await db('accounts').insert([
                    {
                        ap_id: 'https://my-ghost.com/users/alice',
                        username: 'alice',
                        domain: 'my-ghost.com', // Domain CONTAINS "ghost"
                        ap_inbox_url: 'https://my-ghost.com/users/alice/inbox',
                        name: 'Alice',
                        bio: 'Some normal bio',
                    },
                    {
                        ap_id: 'https://example.com/users/bob',
                        username: 'bob',
                        domain: 'example.com',
                        ap_inbox_url: 'https://example.com/users/bob/inbox',
                        name: 'Bob',
                        bio: 'I love ghost stories', // Bio CONTAINS "ghost"
                    },
                ]);

                const accounts = await accountSearchView.search(
                    'ghost',
                    viewer.id,
                );

                expect(accounts).toHaveLength(2);
                expect(accounts[0].name).toBe('Alice');
                expect(accounts[1].name).toBe('Bob');
            });

            it('should prioritize Ghost sites within same relevance score', async () => {
                const [viewer] = await fixtureManager.createInternalAccount();

                // Create an internal account (Ghost site) - has user record
                const [ghostSite] =
                    await fixtureManager.createInternalAccount();

                await db('accounts')
                    .where('id', ghostSite.id)
                    .update({ name: 'Ghost Site Test' });

                // Create external account with same relevance (name starts with)
                await db('accounts').insert({
                    ap_id: 'https://example.com/users/external',
                    username: 'external',
                    domain: 'example.com',
                    ap_inbox_url: 'https://example.com/users/external/inbox',
                    name: 'Ghost External Test',
                    bio: 'An external account',
                });

                const accounts = await accountSearchView.search(
                    'ghost',
                    viewer.id,
                );

                expect(accounts).toHaveLength(2);
                // Both have same relevance (name starts with "ghost")
                // Ghost site should appear first
                expect(accounts[0].name).toBe('Ghost Site Test');
                expect(accounts[1].name).toBe('Ghost External Test');
            });
        });

        describe('field matching', () => {
            it('should match accounts by name', async () => {
                const [viewer] = await fixtureManager.createInternalAccount();

                await db('accounts').insert({
                    ap_id: 'https://example.com/users/alice',
                    username: 'alice',
                    domain: 'example.com',
                    ap_inbox_url: 'https://example.com/users/alice/inbox',
                    name: 'Ghost Publishing',
                    bio: 'Some bio',
                });

                const accounts = await accountSearchView.search(
                    'ghost',
                    viewer.id,
                );

                expect(accounts).toHaveLength(1);
                expect(accounts[0].name).toBe('Ghost Publishing');
            });

            it('should match accounts by username', async () => {
                const [viewer] = await fixtureManager.createInternalAccount();

                await db('accounts').insert({
                    ap_id: 'https://example.com/users/ghostuser',
                    username: 'ghostuser',
                    domain: 'example.com',
                    ap_inbox_url: 'https://example.com/users/ghostuser/inbox',
                    name: 'Some Name',
                    bio: 'Some bio',
                });

                const accounts = await accountSearchView.search(
                    'ghost',
                    viewer.id,
                );

                expect(accounts).toHaveLength(1);
                expect(accounts[0].handle).toBe('@ghostuser@example.com');
            });

            it('should match accounts by domain', async () => {
                const [viewer] = await fixtureManager.createInternalAccount();

                await db('accounts').insert({
                    ap_id: 'https://ghost.org/users/alice',
                    username: 'alice',
                    domain: 'ghost.org',
                    ap_inbox_url: 'https://ghost.org/users/alice/inbox',
                    name: 'Alice',
                    bio: 'Some bio',
                });

                const accounts = await accountSearchView.search(
                    'ghost',
                    viewer.id,
                );

                expect(accounts).toHaveLength(1);
                expect(accounts[0].handle).toBe('@alice@ghost.org');
            });

            it('should match accounts by bio', async () => {
                const [viewer] = await fixtureManager.createInternalAccount();

                await db('accounts').insert({
                    ap_id: 'https://example.com/users/alice',
                    username: 'alice',
                    domain: 'example.com',
                    ap_inbox_url: 'https://example.com/users/alice/inbox',
                    name: 'Alice',
                    bio: 'I write ghost stories',
                });

                const accounts = await accountSearchView.search(
                    'ghost',
                    viewer.id,
                );

                expect(accounts).toHaveLength(1);
                expect(accounts[0].name).toBe('Alice');
            });

            it('should be case-insensitive', async () => {
                const [viewer] = await fixtureManager.createInternalAccount();

                await db('accounts').insert({
                    ap_id: 'https://example.com/users/ghost',
                    username: 'ghost',
                    domain: 'example.com',
                    ap_inbox_url: 'https://example.com/users/ghost/inbox',
                    name: 'Ghost Publishing',
                    bio: 'Some bio',
                });

                const queries = ['ghost', 'Ghost', 'GHOST', 'gHoSt'];

                for (const query of queries) {
                    const accounts = await accountSearchView.search(
                        query,
                        viewer.id,
                    );

                    expect(accounts).toHaveLength(1);
                    expect(accounts[0].name).toBe('Ghost Publishing');
                }
            });
        });

        describe('filtering', () => {
            it('should filter out blocked accounts', async () => {
                const [viewer] = await fixtureManager.createInternalAccount();
                const [accountOne] =
                    await fixtureManager.createInternalAccount();
                const [accountTwo] =
                    await fixtureManager.createInternalAccount();
                const [blockedAccount] =
                    await fixtureManager.createInternalAccount();

                await db('accounts')
                    .where('id', accountOne.id)
                    .update({ name: 'Ghost Account One' });

                await db('accounts')
                    .where('id', accountTwo.id)
                    .update({ name: 'Ghost Account Two' });

                await db('accounts')
                    .where('id', blockedAccount.id)
                    .update({ name: 'Ghost Account Three' });

                await fixtureManager.createBlock(viewer, blockedAccount);

                const accounts = await accountSearchView.search(
                    'ghost',
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
                const [accountOne] =
                    await fixtureManager.createInternalAccount();
                const externalAccount =
                    await fixtureManager.createExternalAccount(
                        'https://blocked-domain.com/',
                    );

                await db('accounts')
                    .where('id', accountOne.id)
                    .update({ name: 'Ghost Account One' });

                await db('accounts')
                    .where('id', externalAccount.id)
                    .update({ name: 'Ghost Account Two' });

                await fixtureManager.createDomainBlock(
                    viewer,
                    new URL('https://blocked-domain.com'),
                );

                const accounts = await accountSearchView.search(
                    'ghost',
                    viewer.id,
                );

                expect(accounts).toHaveLength(1);
                expect(accounts[0].id).toBe(accountOne.apId.toString());
            });

            it('should limit results to maximum', async () => {
                const [viewer] = await fixtureManager.createInternalAccount();

                // Create 25 accounts
                for (let i = 0; i < 25; i++) {
                    await db('accounts').insert({
                        ap_id: `https://example.com/users/ghost_${i}`,
                        username: `ghost_${i}`,
                        domain: 'example.com',
                        ap_inbox_url: `https://example.com/users/ghost_${i}/inbox`,
                        name: `Ghost Account ${i.toString().padStart(2, '0')}`,
                        bio: 'A ghost account',
                    });
                }

                // Should return maximum of 20 results
                const accounts = await accountSearchView.search(
                    'ghost',
                    viewer.id,
                );

                expect(accounts).toHaveLength(20);
            });
        });

        describe('SQL wildcard escaping in relevance scoring', () => {
            it('should treat underscore literally in relevance scoring', async () => {
                const [viewer] = await fixtureManager.createInternalAccount();

                await db('accounts').insert([
                    {
                        ap_id: 'https://example.com/users/test_starts',
                        username: 'teststarts',
                        domain: 'example.com',
                        ap_inbox_url:
                            'https://example.com/users/test_starts/inbox',
                        name: 'Test_Name', // Name STARTS with "Test_"
                        bio: 'A test account',
                    },
                    {
                        ap_id: 'https://example.com/users/testxname',
                        username: 'testxname',
                        domain: 'example.com',
                        ap_inbox_url:
                            'https://example.com/users/testxname/inbox',
                        name: 'TestXName', // Without escaped _, this would also match "Test_"
                        bio: 'Another test account',
                    },
                ]);

                // Search for "Test_" - underscore should be treated literally in scoring
                // Both accounts found by FULLTEXT, but only "Test_Name" gets name-starts-with score
                const accounts = await accountSearchView.search(
                    'Test_',
                    viewer.id,
                );

                expect(accounts).toHaveLength(2);
                // "Test_Name" should rank higher (name starts with literal "Test_")
                expect(accounts[0].name).toBe('Test_Name');
            });

            it('should treat percent literally in relevance scoring', async () => {
                const [viewer] = await fixtureManager.createInternalAccount();

                await db('accounts').insert([
                    {
                        ap_id: 'https://example.com/users/percent',
                        username: 'testpercent',
                        domain: 'example.com',
                        ap_inbox_url: 'https://example.com/users/percent/inbox',
                        name: 'Test%Name', // Name STARTS with "Test%"
                        bio: 'A test account',
                    },
                    {
                        ap_id: 'https://example.com/users/testanything',
                        username: 'testanything',
                        domain: 'example.com',
                        ap_inbox_url:
                            'https://example.com/users/testanything/inbox',
                        name: 'TestAnythingName', // Without escaped %, this would also match "Test%"
                        bio: 'Another test account',
                    },
                ]);

                // Search for "Test%" - percent should be treated literally in scoring
                const accounts = await accountSearchView.search(
                    'Test%',
                    viewer.id,
                );

                expect(accounts).toHaveLength(2);
                // "Test%Name" should rank higher (name starts with literal "Test%")
                expect(accounts[0].name).toBe('Test%Name');
            });

            it('should treat backslash literally in relevance scoring', async () => {
                const [viewer] = await fixtureManager.createInternalAccount();

                await db('accounts').insert([
                    {
                        ap_id: 'https://example.com/users/backslash',
                        username: 'testbackslash',
                        domain: 'example.com',
                        ap_inbox_url:
                            'https://example.com/users/backslash/inbox',
                        name: 'Test\\Name', // Name contains literal backslash
                        bio: 'A test account',
                    },
                    {
                        ap_id: 'https://example.com/users/testname',
                        username: 'testname',
                        domain: 'example.com',
                        ap_inbox_url:
                            'https://example.com/users/testname/inbox',
                        name: 'TestName',
                        bio: 'Another test account',
                    },
                ]);

                // Search for "Test\" - backslash should be treated literally in scoring
                const accounts = await accountSearchView.search(
                    'Test\\',
                    viewer.id,
                );

                expect(accounts).toHaveLength(2);
                // "Test\Name" should rank higher (name starts with literal "Test\")
                expect(accounts[0].name).toBe('Test\\Name');
            });
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
