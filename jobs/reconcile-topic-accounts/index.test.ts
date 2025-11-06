import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    test,
} from 'bun:test';

import {
    type CryptographicKey,
    Endpoints,
    Image,
    Person,
    PropertyValue,
} from '@fedify/fedify';
import mysql, { type RowDataPacket } from 'mysql2/promise';

import { TopicAccountReconciler } from './lib/TopicAccountReconciler';

describe('reconcile-topic-accounts', () => {
    let pool: mysql.Pool;

    beforeAll(async () => {
        pool = mysql.createPool({
            connectionLimit: 10,
            host: 'localhost',
            port: 3308,
            user: 'root',
            password: 'root',
            database: 'reconcile-topic-accounts',
        });

        await pool.execute(`
            CREATE TABLE IF NOT EXISTS accounts (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

                uuid CHAR(36) NULL UNIQUE,
                username VARCHAR(255) NOT NULL,
                name VARCHAR(255),
                bio TEXT,
                avatar_url VARCHAR(1024),
                banner_image_url VARCHAR(1024),
                url VARCHAR(1024),

                custom_fields JSON,

                ap_id VARCHAR(1024) NOT NULL,
                ap_inbox_url VARCHAR(1024) NOT NULL,
                ap_shared_inbox_url VARCHAR(1024),
                ap_outbox_url VARCHAR(1024),
                ap_following_url VARCHAR(1024),
                ap_followers_url VARCHAR(1024),
                ap_liked_url VARCHAR(1024),
                ap_public_key TEXT,
                ap_private_key TEXT,

                domain VARCHAR(255) NOT NULL,
                domain_hash BINARY(32) GENERATED ALWAYS AS (UNHEX(SHA2(LOWER(domain), 256))) STORED,

                KEY idx_accounts_username (username),
                KEY idx_accounts_domain_hash (domain_hash)
            )
        `);

        await pool.execute(`
            CREATE TABLE IF NOT EXISTS topics (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                slug VARCHAR(255) NOT NULL UNIQUE
            )
        `);

        await pool.execute(`
            CREATE TABLE IF NOT EXISTS account_topics (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                account_id INT UNSIGNED NOT NULL,
                topic_id INT UNSIGNED NOT NULL,
                FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
                FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE,
                UNIQUE KEY unique_account_topic (account_id, topic_id)
            )
        `);
    });

    afterAll(async () => {
        await pool.execute('DROP TABLE IF EXISTS account_topics');
        await pool.execute('DROP TABLE IF EXISTS topics');
        await pool.execute('DROP TABLE IF EXISTS accounts');
        await pool.end();
    });

    beforeEach(async () => {
        await pool.execute('DELETE FROM account_topics');
        await pool.execute('DELETE FROM topics');
        await pool.execute('DELETE FROM accounts');
    });

    function createMockActor(domain: string) {
        const actor = new Person({
            id: new URL(`https://${domain}/actor`),
            preferredUsername: 'index',
            name: `Site at ${domain}`,
            summary: `Bio for ${domain}`,
            inbox: new URL(`https://${domain}/inbox`),
            outbox: new URL(`https://${domain}/outbox`),
            following: new URL(`https://${domain}/following`),
            followers: new URL(`https://${domain}/followers`),
            liked: new URL(`https://${domain}/liked`),
            url: new URL(`https://${domain}`),
            icon: new Image({
                url: new URL(`https://${domain}/avatar.jpg`),
            }),
            image: new Image({
                url: new URL(`https://${domain}/banner.jpg`),
            }),
            endpoints: new Endpoints({
                sharedInbox: new URL(`https://${domain}/shared-inbox`),
            }),
            attachments: [
                new PropertyValue({
                    name: 'Website',
                    value: `https://${domain}`,
                }),
            ],
        });

        actor.getPublicKey = async () =>
            ({
                id: new URL(`https://${domain}/actor#main-key`),
                owner: new URL(`https://${domain}/actor`),
                publicKey: null as unknown as CryptoKey,
                toJsonLd: async () => ({
                    id: `https://${domain}/actor#main-key`,
                    owner: `https://${domain}/actor`,
                    publicKeyPem:
                        '-----BEGIN PUBLIC KEY-----\nMOCK_KEY\n-----END PUBLIC KEY-----',
                }),
            }) as unknown as CryptographicKey;

        return actor;
    }

    test('it should create new topics from data source', async () => {
        const reconciler = new TopicAccountReconciler(pool);

        reconciler.fetchData = async () => [
            { domain: 'foo.com', topic: 'Technology' },
            { domain: 'bar.com', topic: 'Finance' },
        ];

        reconciler.fetchActorForDomain = async (domain) =>
            createMockActor(domain);

        await reconciler.reconcileAccountsForTopics();

        const [topics] = await pool.execute<RowDataPacket[]>(
            'SELECT name, slug FROM topics ORDER BY name',
        );

        expect(topics.length).toBe(2);
        expect(topics[0].name).toBe('Finance');
        expect(topics[0].slug).toBe('finance');
        expect(topics[1].name).toBe('Technology');
        expect(topics[1].slug).toBe('technology');
    });

    test('it should delete topics not in data source', async () => {
        const reconciler = new TopicAccountReconciler(pool);

        await pool.execute(
            'INSERT INTO topics (name, slug) VALUES (?, ?), (?, ?)',
            ['Finance', 'finance', 'Technology', 'technology'],
        );

        reconciler.fetchData = async () => [
            { domain: 'foo.com', topic: 'Technology' },
        ];

        reconciler.fetchActorForDomain = async (domain) =>
            createMockActor(domain);

        await reconciler.reconcileAccountsForTopics();

        const [topics] = await pool.execute<RowDataPacket[]>(
            'SELECT name FROM topics',
        );

        expect(topics.length).toBe(1);
        expect(topics[0].name).toBe('Technology');
    });

    test('it should create new accounts', async () => {
        const reconciler = new TopicAccountReconciler(pool);

        reconciler.fetchData = async () => [
            { domain: 'foo.com', topic: 'Technology' },
            { domain: 'bar.com', topic: 'Technology' },
        ];

        reconciler.fetchActorForDomain = async (domain) =>
            createMockActor(domain);

        await reconciler.reconcileAccountsForTopics();

        const [accounts] = await pool.execute<RowDataPacket[]>(
            `SELECT
                username,
                domain,
                ap_id,
                name,
                bio,
                avatar_url,
                banner_image_url,
                url,
                ap_inbox_url,
                ap_outbox_url,
                ap_following_url,
                ap_followers_url,
                ap_liked_url,
                ap_shared_inbox_url,
                ap_public_key,
                custom_fields
            FROM accounts ORDER BY domain`,
        );

        expect(accounts.length).toBe(2);

        // Check bar.com account
        expect(accounts[0].username).toBe('index');
        expect(accounts[0].domain).toBe('bar.com');
        expect(accounts[0].ap_id).toBe('https://bar.com/actor');
        expect(accounts[0].name).toBe('Site at bar.com');
        expect(accounts[0].bio).toBe('Bio for bar.com');
        expect(accounts[0].avatar_url).toBe('https://bar.com/avatar.jpg');
        expect(accounts[0].banner_image_url).toBe('https://bar.com/banner.jpg');
        expect(accounts[0].url).toBe('https://bar.com/');
        expect(accounts[0].ap_inbox_url).toBe('https://bar.com/inbox');
        expect(accounts[0].ap_outbox_url).toBe('https://bar.com/outbox');
        expect(accounts[0].ap_following_url).toBe('https://bar.com/following');
        expect(accounts[0].ap_followers_url).toBe('https://bar.com/followers');
        expect(accounts[0].ap_liked_url).toBe('https://bar.com/liked');
        expect(accounts[0].ap_shared_inbox_url).toBe(
            'https://bar.com/shared-inbox',
        );

        // ap_public_key is stored as JSON with id, owner, and publicKeyPem
        const barPublicKey = JSON.parse(accounts[0].ap_public_key);
        expect(barPublicKey.id).toBe('https://bar.com/actor#main-key');
        expect(barPublicKey.owner).toBe('https://bar.com/actor');
        expect(barPublicKey.publicKeyPem).toBe(
            '-----BEGIN PUBLIC KEY-----\nMOCK_KEY\n-----END PUBLIC KEY-----',
        );

        // custom_fields is stored as an object with field names as keys
        // MySQL JSON column is already parsed by the driver
        expect(accounts[0].custom_fields).toEqual({
            Website: 'https://bar.com',
        });

        // Check foo.com account
        expect(accounts[1].username).toBe('index');
        expect(accounts[1].domain).toBe('foo.com');
        expect(accounts[1].ap_id).toBe('https://foo.com/actor');
        expect(accounts[1].name).toBe('Site at foo.com');
        expect(accounts[1].bio).toBe('Bio for foo.com');
        expect(accounts[1].avatar_url).toBe('https://foo.com/avatar.jpg');
        expect(accounts[1].banner_image_url).toBe('https://foo.com/banner.jpg');
        expect(accounts[1].url).toBe('https://foo.com/');
        expect(accounts[1].ap_inbox_url).toBe('https://foo.com/inbox');
        expect(accounts[1].ap_outbox_url).toBe('https://foo.com/outbox');
        expect(accounts[1].ap_following_url).toBe('https://foo.com/following');
        expect(accounts[1].ap_followers_url).toBe('https://foo.com/followers');
        expect(accounts[1].ap_liked_url).toBe('https://foo.com/liked');
        expect(accounts[1].ap_shared_inbox_url).toBe(
            'https://foo.com/shared-inbox',
        );

        // ap_public_key is stored as JSON with id, owner, and publicKeyPem
        const fooPublicKey = JSON.parse(accounts[1].ap_public_key);
        expect(fooPublicKey.id).toBe('https://foo.com/actor#main-key');
        expect(fooPublicKey.owner).toBe('https://foo.com/actor');
        expect(fooPublicKey.publicKeyPem).toBe(
            '-----BEGIN PUBLIC KEY-----\nMOCK_KEY\n-----END PUBLIC KEY-----',
        );

        // custom_fields is stored as an object with field names as keys
        // MySQL JSON column is already parsed by the driver
        expect(accounts[1].custom_fields).toEqual({
            Website: 'https://foo.com',
        });
    });

    test('it should create account_topics mappings', async () => {
        const reconciler = new TopicAccountReconciler(pool);

        reconciler.fetchData = async () => [
            { domain: 'foo.com', topic: 'Technology' },
            { domain: 'bar.com', topic: 'Technology' },
            { domain: 'foo.com', topic: 'Finance' },
        ];

        reconciler.fetchActorForDomain = async (domain) =>
            createMockActor(domain);

        await reconciler.reconcileAccountsForTopics();

        const [mappings] = await pool.execute<RowDataPacket[]>(
            `SELECT a.domain, t.name
             FROM account_topics at
             JOIN accounts a ON a.id = at.account_id
             JOIN topics t ON t.id = at.topic_id
             ORDER BY a.domain, t.name`,
        );

        expect(mappings.length).toBe(3);
        expect(mappings[0]).toEqual({
            domain: 'bar.com',
            name: 'Technology',
        });
        expect(mappings[1]).toEqual({
            domain: 'foo.com',
            name: 'Finance',
        });
        expect(mappings[2]).toEqual({
            domain: 'foo.com',
            name: 'Technology',
        });
    });

    test('it should delete removed mappings', async () => {
        const reconciler = new TopicAccountReconciler(pool);

        await pool.execute(
            'INSERT INTO accounts (username, ap_id, ap_inbox_url, domain, ap_public_key) VALUES (?, ?, ?, ?, ?)',
            [
                'index',
                'https://foo.com/actor',
                'https://foo.com/inbox',
                'foo.com',
                null,
            ],
        );
        const [accounts] = await pool.execute<RowDataPacket[]>(
            'SELECT id FROM accounts WHERE domain = ?',
            ['foo.com'],
        );
        const accountId = accounts[0].id;

        await pool.execute(
            'INSERT INTO topics (name, slug) VALUES (?, ?), (?, ?)',
            ['Technology', 'technology', 'Finance', 'finance'],
        );
        const [topics] = await pool.execute<RowDataPacket[]>(
            'SELECT id, name FROM topics ORDER BY name',
        );
        const financeId = topics[0].id;
        const techId = topics[1].id;

        await pool.execute(
            'INSERT INTO account_topics (account_id, topic_id) VALUES (?, ?), (?, ?)',
            [accountId, techId, accountId, financeId],
        );

        reconciler.fetchData = async () => [
            { domain: 'foo.com', topic: 'Technology' },
        ];

        reconciler.fetchActorForDomain = async (domain) =>
            createMockActor(domain);

        await reconciler.reconcileAccountsForTopics();

        const [remainingMappings] = await pool.execute<RowDataPacket[]>(
            `SELECT t.name
             FROM account_topics at
             JOIN topics t ON t.id = at.topic_id
             WHERE at.account_id = ?`,
            [accountId],
        );

        expect(remainingMappings.length).toBe(1);
        expect(remainingMappings[0].name).toBe('Technology');
    });

    test('it should handle actor fetch failures gracefully', async () => {
        const reconciler = new TopicAccountReconciler(pool);

        reconciler.fetchData = async () => [
            { domain: 'foo.com', topic: 'Technology' },
            { domain: 'failing-site.com', topic: 'Technology' },
        ];

        reconciler.fetchActorForDomain = async (domain) => {
            if (domain === 'failing-site.com') {
                return null;
            }
            return createMockActor(domain);
        };

        await reconciler.reconcileAccountsForTopics();

        const [accounts] = await pool.execute<RowDataPacket[]>(
            'SELECT domain FROM accounts',
        );

        expect(accounts.length).toBe(1);
        expect(accounts[0].domain).toBe('foo.com');
    });

    test('it should be idempotent', async () => {
        const reconciler = new TopicAccountReconciler(pool);

        reconciler.fetchData = async () => [
            { domain: 'foo.com', topic: 'Technology' },
            { domain: 'bar.com', topic: 'Finance' },
        ];

        reconciler.fetchActorForDomain = async (domain) =>
            createMockActor(domain);

        await reconciler.reconcileAccountsForTopics();

        const [accounts1] = await pool.execute<RowDataPacket[]>(
            'SELECT COUNT(*) as count FROM accounts',
        );
        const [topics1] = await pool.execute<RowDataPacket[]>(
            'SELECT COUNT(*) as count FROM topics',
        );
        const [mappings1] = await pool.execute<RowDataPacket[]>(
            'SELECT COUNT(*) as count FROM account_topics',
        );

        await reconciler.reconcileAccountsForTopics();

        const [accounts2] = await pool.execute<RowDataPacket[]>(
            'SELECT COUNT(*) as count FROM accounts',
        );
        const [topics2] = await pool.execute<RowDataPacket[]>(
            'SELECT COUNT(*) as count FROM topics',
        );
        const [mappings2] = await pool.execute<RowDataPacket[]>(
            'SELECT COUNT(*) as count FROM account_topics',
        );

        expect(accounts1[0].count).toBe(accounts2[0].count);
        expect(topics1[0].count).toBe(topics2[0].count);
        expect(mappings1[0].count).toBe(mappings2[0].count);
    });

    test('it should delete topics with cascade delete of account_topics', async () => {
        const reconciler = new TopicAccountReconciler(pool);

        await pool.execute(
            'INSERT INTO accounts (username, ap_id, ap_inbox_url, domain, ap_public_key) VALUES (?, ?, ?, ?, ?)',
            [
                'index',
                'https://foo.com/actor',
                'https://foo.com/inbox',
                'foo.com',
                null,
            ],
        );
        const [accounts] = await pool.execute<RowDataPacket[]>(
            'SELECT id FROM accounts WHERE domain = ?',
            ['foo.com'],
        );
        const accountId = accounts[0].id;

        await pool.execute('INSERT INTO topics (name, slug) VALUES (?, ?)', [
            'Finance',
            'finance',
        ]);
        const [topics] = await pool.execute<RowDataPacket[]>(
            'SELECT id FROM topics WHERE name = ?',
            ['Finance'],
        );
        const topicId = topics[0].id;

        await pool.execute(
            'INSERT INTO account_topics (account_id, topic_id) VALUES (?, ?)',
            [accountId, topicId],
        );

        const [mappingsBefore] = await pool.execute<RowDataPacket[]>(
            'SELECT COUNT(*) as count FROM account_topics',
        );
        expect(mappingsBefore[0].count).toBe(1);

        reconciler.fetchData = async () => [];

        reconciler.fetchActorForDomain = async (domain) =>
            createMockActor(domain);

        await reconciler.reconcileAccountsForTopics();

        const [topicsAfter] = await pool.execute<RowDataPacket[]>(
            'SELECT COUNT(*) as count FROM topics',
        );
        expect(topicsAfter[0].count).toBe(0);

        const [mappingsAfter] = await pool.execute<RowDataPacket[]>(
            'SELECT COUNT(*) as count FROM account_topics',
        );
        expect(mappingsAfter[0].count).toBe(0);
    });

    test('it should not create duplicate accounts for same domain', async () => {
        const reconciler = new TopicAccountReconciler(pool);

        reconciler.fetchData = async () => [
            { domain: 'foo.com', topic: 'Technology' },
            { domain: 'foo.com', topic: 'Finance' },
        ];

        reconciler.fetchActorForDomain = async (domain) =>
            createMockActor(domain);

        await reconciler.reconcileAccountsForTopics();

        const [accounts] = await pool.execute<RowDataPacket[]>(
            'SELECT COUNT(*) as count FROM accounts WHERE domain = ?',
            ['foo.com'],
        );

        expect(accounts[0].count).toBe(1);
    });

    test('it should merge topics with same slug into single topic', async () => {
        const reconciler = new TopicAccountReconciler(pool);

        reconciler.fetchData = async () => [
            { domain: 'foo.com', topic: 'Technology' },
            { domain: 'bar.com', topic: 'technology' },
            { domain: 'baz.com', topic: 'TECHNOLOGY' },
        ];

        reconciler.fetchActorForDomain = async (domain) =>
            createMockActor(domain);

        await reconciler.reconcileAccountsForTopics();

        // Should only create one topic with canonical name (alphabetically first)
        const [topics] = await pool.execute<RowDataPacket[]>(
            'SELECT name, slug FROM topics ORDER BY name',
        );

        expect(topics.length).toBe(1);
        expect(topics[0].name).toBe('TECHNOLOGY'); // Alphabetically first
        expect(topics[0].slug).toBe('technology');

        // All three accounts should be mapped to the single topic
        const [mappings] = await pool.execute<RowDataPacket[]>(
            'SELECT COUNT(*) as count FROM account_topics',
        );

        expect(mappings[0].count).toBe(3);

        // Verify all three domains have accounts
        const [accounts] = await pool.execute<RowDataPacket[]>(
            'SELECT domain FROM accounts ORDER BY domain',
        );

        expect(accounts.length).toBe(3);
        expect(accounts[0].domain).toBe('bar.com');
        expect(accounts[1].domain).toBe('baz.com');
        expect(accounts[2].domain).toBe('foo.com');
    });

    test('it should handle actor domain mismatch correctly', async () => {
        const reconciler = new TopicAccountReconciler(pool);

        reconciler.fetchData = async () => [
            { domain: 'foo.com', topic: 'Technology' },
        ];

        // Mock an actor where the actor's ID domain differs from input domain
        reconciler.fetchActorForDomain = async (domain) => {
            const actor = new Person({
                id: new URL('https://different-domain.com/actor'),
                preferredUsername: 'index',
                name: `Site at ${domain}`,
                summary: `Bio for ${domain}`,
                inbox: new URL('https://different-domain.com/inbox'),
                outbox: new URL('https://different-domain.com/outbox'),
                following: new URL('https://different-domain.com/following'),
                followers: new URL('https://different-domain.com/followers'),
                liked: new URL('https://different-domain.com/liked'),
                url: new URL(`https://${domain}`),
                endpoints: new Endpoints({
                    sharedInbox: new URL(
                        'https://different-domain.com/shared-inbox',
                    ),
                }),
            });

            actor.getPublicKey = async () =>
                ({
                    id: new URL('https://different-domain.com/actor#main-key'),
                    owner: new URL('https://different-domain.com/actor'),
                    publicKey: null as unknown as CryptoKey,
                    toJsonLd: async () => ({
                        id: 'https://different-domain.com/actor#main-key',
                        owner: 'https://different-domain.com/actor',
                        publicKeyPem:
                            '-----BEGIN PUBLIC KEY-----\nMOCK_KEY\n-----END PUBLIC KEY-----',
                    }),
                }) as unknown as CryptographicKey;

            return actor;
        };

        await reconciler.reconcileAccountsForTopics();

        // Account should be created with the input domain, not the actor domain
        const [accounts] = await pool.execute<RowDataPacket[]>(
            'SELECT domain, ap_id FROM accounts WHERE domain = ?',
            ['foo.com'],
        );

        expect(accounts.length).toBe(1);
        expect(accounts[0].domain).toBe('foo.com');
        expect(accounts[0].ap_id).toBe('https://different-domain.com/actor');

        // Verify no account was created with the actor's domain
        const [actorDomainAccounts] = await pool.execute<RowDataPacket[]>(
            'SELECT COUNT(*) as count FROM accounts WHERE domain = ?',
            ['different-domain.com'],
        );

        expect(actorDomainAccounts[0].count).toBe(0);

        // Verify topic mapping was created successfully
        const [mappings] = await pool.execute<RowDataPacket[]>(
            'SELECT COUNT(*) as count FROM account_topics',
        );

        expect(mappings[0].count).toBe(1);
    });

    // Smoke test using real data - Not run by default
    test.skip('e2e smoke test', async () => {
        const reconciler = new TopicAccountReconciler(pool);

        // Insert data that should be removed during reconciliation

        // Insert topic that is not associated with any accounts
        await pool.execute('INSERT INTO topics (name, slug) VALUES (?, ?)', [
            'Travel',
            'travel',
        ]);

        // Insert topic that is associated with an account that won't be in the data source
        await pool.execute('INSERT INTO topics (name, slug) VALUES (?, ?)', [
            'Finance',
            'finance',
        ]);

        const [financeTopics] = await pool.execute<RowDataPacket[]>(
            'SELECT id FROM topics WHERE name = ?',
            ['Finance'],
        );
        const financeTopicId = financeTopics[0].id;

        await pool.execute(
            'INSERT INTO accounts (username, ap_id, ap_inbox_url, domain, ap_public_key) VALUES (?, ?, ?, ?, ?)',
            [
                'index',
                'https://example.com/actor',
                'https://example.com/inbox',
                'example.com',
                null,
            ],
        );

        const [removableAccounts] = await pool.execute<RowDataPacket[]>(
            'SELECT id FROM accounts WHERE domain = ?',
            ['example.com'],
        );
        const removableAccountId = removableAccounts[0].id;

        await pool.execute(
            'INSERT INTO account_topics (account_id, topic_id) VALUES (?, ?)',
            [removableAccountId, financeTopicId],
        );

        // Use real Ghost sites with ActivityPub enabled

        reconciler.fetchData = async () => [
            { domain: 'activitypub.ghost.org', topic: 'Technology' },
            { domain: 'main.ghost.org', topic: 'Publishing' },
            { domain: 'www.404media.co', topic: 'News' },
            { domain: 'www.platformer.news', topic: 'News' },
        ];

        // Run the reconciler

        await reconciler.reconcileAccountsForTopics();

        // Check the outcome

        const [accounts] = await pool.execute<RowDataPacket[]>(
            `SELECT
                username,
                domain,
                ap_id,
                name,
                bio,
                avatar_url,
                banner_image_url,
                url,
                ap_inbox_url,
                ap_outbox_url,
                ap_following_url,
                ap_followers_url,
                ap_liked_url,
                ap_shared_inbox_url,
                ap_public_key,
                custom_fields
            FROM accounts ORDER BY domain`,
        );

        // Should have created 4 accounts (one for each domain)
        expect(accounts.length).toBeGreaterThanOrEqual(4);

        // Check all accounts have required fields populated
        for (const account of accounts) {
            // Verify required fields are populated
            expect(account.username).toBeTruthy();
            expect(account.domain).toBeTruthy();
            expect(account.ap_id).toBeTruthy();
            expect(account.ap_inbox_url).toBeTruthy();

            // Verify AP URLs are valid URLs
            expect(account.ap_id).toMatch(/^https?:\/\/.+/);
            expect(account.ap_inbox_url).toMatch(/^https?:\/\/.+/);

            if (account.ap_outbox_url) {
                expect(account.ap_outbox_url).toMatch(/^https?:\/\/.+/);
            }
            if (account.ap_following_url) {
                expect(account.ap_following_url).toMatch(/^https?:\/\/.+/);
            }
            if (account.ap_followers_url) {
                expect(account.ap_followers_url).toMatch(/^https?:\/\/.+/);
            }
            if (account.ap_shared_inbox_url) {
                expect(account.ap_shared_inbox_url).toMatch(/^https?:\/\/.+/);
            }

            // Verify public key structure if present
            if (account.ap_public_key) {
                const publicKey = JSON.parse(account.ap_public_key);
                expect(publicKey).toHaveProperty('id');
                expect(publicKey).toHaveProperty('owner');
                expect(publicKey).toHaveProperty('publicKeyPem');
                expect(publicKey.publicKeyPem).toMatch(
                    /-----BEGIN PUBLIC KEY-----/,
                );
            }

            // Verify custom fields structure if present
            if (account.custom_fields) {
                expect(typeof account.custom_fields).toBe('object');
            }

            // Verify avatar and banner URLs if present
            if (account.avatar_url) {
                expect(account.avatar_url).toMatch(/^https?:\/\/.+/);
            }
            if (account.banner_image_url) {
                expect(account.banner_image_url).toMatch(/^https?:\/\/.+/);
            }
            if (account.url) {
                expect(account.url).toMatch(/^https?:\/\/.+/);
            }
        }

        // Verify topics were created (Technology, Publishing, News)
        const [topics] = await pool.execute<RowDataPacket[]>(
            'SELECT name FROM topics ORDER BY name',
        );
        expect(topics.length).toBe(3);
        const topicNames = topics.map((t) => t.name);
        expect(topicNames).toContain('Technology');
        expect(topicNames).toContain('Publishing');
        expect(topicNames).toContain('News');

        // Verify account-topic mappings were created
        const [mappings] = await pool.execute<RowDataPacket[]>(
            `SELECT COUNT(*) as count FROM account_topics`,
        );
        // Should have 4 mappings total (1 for each domain)
        expect(mappings[0].count).toBe(4);

        // Verify removable data was cleaned up
        // Travel topic and account should be deleted (not in data source)
        const [travelCheck] = await pool.execute<RowDataPacket[]>(
            'SELECT COUNT(*) as count FROM topics WHERE name = ?',
            ['Travel'],
        );
        expect(travelCheck[0].count).toBe(0);

        // Finance topic should be deleted (not in data source)
        const [financeCheck] = await pool.execute<RowDataPacket[]>(
            'SELECT COUNT(*) as count FROM topics WHERE name = ?',
            ['Finance'],
        );
        expect(financeCheck[0].count).toBe(0);

        // Removable account should still exist (accounts are not deleted by reconciler)
        const [accountCheck] = await pool.execute<RowDataPacket[]>(
            'SELECT COUNT(*) as count FROM accounts WHERE domain = ?',
            ['example.com'],
        );
        expect(accountCheck[0].count).toBe(1);

        // But the removable account-topic mapping should be deleted
        const [mappingCheck] = await pool.execute<RowDataPacket[]>(
            `SELECT COUNT(*) as count
             FROM account_topics at
             JOIN accounts a ON a.id = at.account_id
             WHERE a.domain = ?`,
            ['example.com'],
        );
        expect(mappingCheck[0].count).toBe(0);
    }, 30000);
});
