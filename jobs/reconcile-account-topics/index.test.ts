import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    mock,
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

import { AccountTopicReconciler } from './lib/AccountTopicReconciler';

describe('reconcile-account-topics', () => {
    let pool: mysql.Pool;
    let originalFetch: typeof global.fetch;

    beforeAll(async () => {
        pool = mysql.createPool({
            connectionLimit: 10,
            host: 'localhost',
            port: 3308,
            user: 'root',
            password: 'root',
            database: 'reconcile-account-topics',
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
                rank_in_topic INT UNSIGNED NOT NULL DEFAULT 0,
                FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
                FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE,
                UNIQUE KEY unique_account_topic (account_id, topic_id),
                INDEX idx_account_topics_topic_id_rank_in_topic (topic_id, rank_in_topic)
            )
        `);

        originalFetch = global.fetch;
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

    afterEach(() => {
        global.fetch = originalFetch;
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

    function mockApiResponse(urls: string[], hasNext = false) {
        return {
            data: urls.map((url) => ({
                ghost_uuid: '550e8400-e29b-41d4-a716-446655440000',
                url,
                title: 'Example Site',
                description: 'A great publication',
                locale: 'en',
                ghost_rank: 1,
                posts_total: 150,
                posts_first: '2020-01-15T10:30:00.000000Z',
                posts_last: '2025-01-15T10:30:00.000000Z',
                member_count: 10000,
                created_at: '2020-01-01T00:00:00.000000Z',
                updated_at: '2025-01-15T10:30:00.000000Z',
                categories: [{ name: 'Technology', slug: 'tech' }],
                tags: [{ name: 'Featured' }],
            })),
            links: {
                first: 'https://example.com/api/sites?page=1',
                last: 'https://example.com/api/sites?page=1',
                prev: null,
                next: hasNext ? 'https://example.com/api/sites?page=2' : null,
            },
            meta: {
                current_page: 1,
                from: 1,
                last_page: 1,
                per_page: 100,
                to: urls.length,
                total: urls.length,
            },
        };
    }

    test('it should exit early if no topics in database', async () => {
        const reconciler = new AccountTopicReconciler(
            pool,
            'https://example.com/api/sites',
            'some-api-auth-token',
        );

        await reconciler.run();

        const [accounts] = await pool.execute<RowDataPacket[]>(
            'SELECT COUNT(*) as count FROM accounts',
        );

        expect(accounts[0].count).toBe(0);
    });

    test('it should construct API URL with correct parameters', async () => {
        await pool.execute('INSERT INTO topics (name, slug) VALUES (?, ?)', [
            'Technology',
            'tech',
        ]);

        const reconciler = new AccountTopicReconciler(
            pool,
            'https://example.com/api/sites',
            'some-api-auth-token',
        );

        global.fetch = mock((url: string) => {
            const urlObj = new URL(url);

            // Verify all URL parameters are present and correct
            expect(urlObj.searchParams.get('ap')).toBe('1');
            expect(urlObj.searchParams.get('category')).toBe('tech');
            expect(urlObj.searchParams.get('sort')).toBe('top');
            expect(urlObj.searchParams.get('locale')).toBe('en');

            return Promise.resolve({
                ok: true,
                json: async () => mockApiResponse([]),
            } as Response);
        });

        reconciler.fetchActorForDomain = async (domain) =>
            createMockActor(domain);

        await reconciler.run();
    });

    test('it should use empty category for "top" slug', async () => {
        await pool.execute('INSERT INTO topics (name, slug) VALUES (?, ?)', [
            'Top',
            'top',
        ]);

        const reconciler = new AccountTopicReconciler(
            pool,
            'https://example.com/api/sites',
            'some-api-auth-token',
        );

        global.fetch = mock((url: string) => {
            const urlObj = new URL(url);

            // Verify category parameter is empty for "top" slug
            expect(urlObj.searchParams.get('ap')).toBe('1');
            expect(urlObj.searchParams.get('category')).toBe('');
            expect(urlObj.searchParams.get('sort')).toBe('top');
            expect(urlObj.searchParams.get('locale')).toBe('en');

            return Promise.resolve({
                ok: true,
                json: async () => mockApiResponse([]),
            } as Response);
        });

        reconciler.fetchActorForDomain = async (domain) =>
            createMockActor(domain);

        await reconciler.run();
    });

    test('it should fetch URLs from API and create accounts', async () => {
        await pool.execute(
            'INSERT INTO topics (name, slug) VALUES (?, ?), (?, ?)',
            ['Technology', 'technology', 'Finance', 'finance'],
        );

        const reconciler = new AccountTopicReconciler(
            pool,
            'https://example.com/api/sites',
            'some-api-auth-token',
        );

        global.fetch = mock((url: string) => {
            const urlObj = new URL(url);
            const category = urlObj.searchParams.get('category');

            if (category === 'technology') {
                return Promise.resolve({
                    ok: true,
                    json: async () =>
                        mockApiResponse([
                            'https://foo.com/',
                            'https://bar.com/',
                        ]),
                } as Response);
            }

            if (category === 'finance') {
                return Promise.resolve({
                    ok: true,
                    json: async () => mockApiResponse(['https://baz.com/']),
                } as Response);
            }

            return Promise.resolve({
                ok: false,
                status: 404,
                statusText: 'Not Found',
            } as Response);
        });

        reconciler.fetchActorForDomain = async (domain) =>
            createMockActor(domain);

        await reconciler.run();

        const [accounts] = await pool.execute<RowDataPacket[]>(
            'SELECT domain FROM accounts ORDER BY domain',
        );

        expect(accounts.length).toBe(3);
        expect(accounts[0].domain).toBe('bar.com');
        expect(accounts[1].domain).toBe('baz.com');
        expect(accounts[2].domain).toBe('foo.com');
    });

    test('it should handle pagination correctly', async () => {
        await pool.execute('INSERT INTO topics (name, slug) VALUES (?, ?)', [
            'Technology',
            'technology',
        ]);

        const reconciler = new AccountTopicReconciler(
            pool,
            'https://example.com/api/sites',
            'some-api-auth-token',
        );

        global.fetch = mock((url: string) => {
            if (url.includes('page=2')) {
                return Promise.resolve({
                    ok: true,
                    json: async () =>
                        mockApiResponse(['https://page2-site.com/']),
                } as Response);
            }

            return Promise.resolve({
                ok: true,
                json: async () =>
                    mockApiResponse(['https://page1-site.com/'], true),
            } as Response);
        });

        reconciler.fetchActorForDomain = async (domain) =>
            createMockActor(domain);

        await reconciler.run();

        const [accounts] = await pool.execute<RowDataPacket[]>(
            'SELECT domain FROM accounts ORDER BY domain',
        );

        expect(accounts.length).toBe(2);
        expect(accounts[0].domain).toBe('page1-site.com');
        expect(accounts[1].domain).toBe('page2-site.com');
    });

    test('it should limit to 200 URLs per topic', async () => {
        await pool.execute('INSERT INTO topics (name, slug) VALUES (?, ?)', [
            'Technology',
            'technology',
        ]);

        const reconciler = new AccountTopicReconciler(
            pool,
            'https://example.com/api/sites',
            'some-api-auth-token',
        );

        // Generate 250 URLs
        const allUrls = Array.from(
            { length: 250 },
            (_, i) => `https://site${i}.com/`,
        );

        // Mock paginated responses with 100 per page
        global.fetch = mock((url: string) => {
            const urlObj = new URL(url);
            const page = urlObj.searchParams.get('page') || '1';
            const pageNum = Number.parseInt(page, 10);

            const startIndex = (pageNum - 1) * 100;
            const pageUrls = allUrls.slice(startIndex, startIndex + 100);

            return Promise.resolve({
                ok: true,
                json: async () => mockApiResponse(pageUrls, pageNum < 3),
            } as Response);
        });

        reconciler.fetchActorForDomain = async (domain) =>
            createMockActor(domain);

        await reconciler.run();

        const [accounts] = await pool.execute<RowDataPacket[]>(
            'SELECT COUNT(*) as count FROM accounts',
        );

        // Should only create 200 accounts, not 250
        expect(accounts[0].count).toBe(200);
    });

    test('it should create account-topic mappings', async () => {
        await pool.execute(
            'INSERT INTO topics (name, slug) VALUES (?, ?), (?, ?)',
            ['Technology', 'technology', 'Finance', 'finance'],
        );

        const reconciler = new AccountTopicReconciler(
            pool,
            'https://example.com/api/sites',
            'some-api-auth-token',
        );

        global.fetch = mock((url: string) => {
            const urlObj = new URL(url);
            const category = urlObj.searchParams.get('category');

            if (category === 'technology') {
                return Promise.resolve({
                    ok: true,
                    json: async () =>
                        mockApiResponse([
                            'https://foo.com/',
                            'https://bar.com/',
                        ]),
                } as Response);
            }

            if (category === 'finance') {
                return Promise.resolve({
                    ok: true,
                    json: async () => mockApiResponse(['https://foo.com/']),
                } as Response);
            }

            return Promise.resolve({ ok: false } as Response);
        });

        reconciler.fetchActorForDomain = async (domain) =>
            createMockActor(domain);

        await reconciler.run();

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
        await pool.execute('INSERT INTO topics (name, slug) VALUES (?, ?)', [
            'Technology',
            'technology',
        ]);
        const [topics] = await pool.execute<RowDataPacket[]>(
            'SELECT id FROM topics WHERE name = ?',
            ['Technology'],
        );
        const topicId = topics[0].id;

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

        // Create a mapping that should be removed
        await pool.execute(
            'INSERT INTO account_topics (account_id, topic_id) VALUES (?, ?)',
            [accountId, topicId],
        );

        const reconciler = new AccountTopicReconciler(
            pool,
            'https://example.com/api/sites',
            'some-api-auth-token',
        );

        // Mock API to return empty results for this topic
        global.fetch = mock(() =>
            Promise.resolve({
                ok: true,
                json: async () => mockApiResponse([]),
            } as Response),
        );

        reconciler.fetchActorForDomain = async (domain) =>
            createMockActor(domain);

        await reconciler.run();

        const [remainingMappings] = await pool.execute<RowDataPacket[]>(
            'SELECT COUNT(*) as count FROM account_topics WHERE account_id = ?',
            [accountId],
        );

        expect(remainingMappings[0].count).toBe(0);
    });

    test('it should handle API failures gracefully', async () => {
        await pool.execute(
            'INSERT INTO topics (name, slug) VALUES (?, ?), (?, ?)',
            ['Technology', 'technology', 'Finance', 'finance'],
        );

        const reconciler = new AccountTopicReconciler(
            pool,
            'https://example.com/api/sites',
            'some-api-auth-token',
        );

        global.fetch = mock((url: string) => {
            const urlObj = new URL(url);
            const category = urlObj.searchParams.get('category');

            if (category === 'technology') {
                return Promise.resolve({
                    ok: false,
                    status: 500,
                    statusText: 'Internal Server Error',
                } as Response);
            }

            if (category === 'finance') {
                return Promise.resolve({
                    ok: true,
                    json: async () => mockApiResponse(['https://foo.com/']),
                } as Response);
            }

            return Promise.resolve({ ok: false } as Response);
        });

        reconciler.fetchActorForDomain = async (domain) =>
            createMockActor(domain);

        await reconciler.run();

        // Should only create account for finance topic
        const [accounts] = await pool.execute<RowDataPacket[]>(
            'SELECT domain FROM accounts',
        );

        expect(accounts.length).toBe(1);
        expect(accounts[0].domain).toBe('foo.com');
    });

    test('it should handle actor fetch failures gracefully', async () => {
        await pool.execute('INSERT INTO topics (name, slug) VALUES (?, ?)', [
            'Technology',
            'technology',
        ]);

        const reconciler = new AccountTopicReconciler(
            pool,
            'https://example.com/api/sites',
            'some-api-auth-token',
        );

        global.fetch = mock(() =>
            Promise.resolve({
                ok: true,
                json: async () =>
                    mockApiResponse([
                        'https://foo.com/',
                        'https://failing-site.com/',
                    ]),
            } as Response),
        );

        reconciler.fetchActorForDomain = async (domain) => {
            if (domain === 'failing-site.com') {
                return null;
            }
            return createMockActor(domain);
        };

        await reconciler.run();

        const [accounts] = await pool.execute<RowDataPacket[]>(
            'SELECT domain FROM accounts',
        );

        expect(accounts.length).toBe(1);
        expect(accounts[0].domain).toBe('foo.com');
    });

    test('it should be idempotent', async () => {
        await pool.execute('INSERT INTO topics (name, slug) VALUES (?, ?)', [
            'Technology',
            'technology',
        ]);

        const reconciler = new AccountTopicReconciler(
            pool,
            'https://example.com/api/sites',
            'some-api-auth-token',
        );

        global.fetch = mock(() =>
            Promise.resolve({
                ok: true,
                json: async () =>
                    mockApiResponse(['https://foo.com/', 'https://bar.com/']),
            } as Response),
        );

        reconciler.fetchActorForDomain = async (domain) =>
            createMockActor(domain);

        await reconciler.run();

        const [accounts1] = await pool.execute<RowDataPacket[]>(
            'SELECT COUNT(*) as count FROM accounts',
        );
        const [mappings1] = await pool.execute<RowDataPacket[]>(
            'SELECT COUNT(*) as count FROM account_topics',
        );

        await reconciler.run();

        const [accounts2] = await pool.execute<RowDataPacket[]>(
            'SELECT COUNT(*) as count FROM accounts',
        );
        const [mappings2] = await pool.execute<RowDataPacket[]>(
            'SELECT COUNT(*) as count FROM account_topics',
        );

        expect(accounts1[0].count).toBe(accounts2[0].count);
        expect(mappings1[0].count).toBe(mappings2[0].count);
    });

    test('it should not create duplicate accounts for the same domain', async () => {
        await pool.execute(
            'INSERT INTO topics (name, slug) VALUES (?, ?), (?, ?)',
            ['Technology', 'technology', 'Finance', 'finance'],
        );

        const reconciler = new AccountTopicReconciler(
            pool,
            'https://example.com/api/sites',
            'some-api-auth-token',
        );

        global.fetch = mock(() =>
            Promise.resolve({
                ok: true,
                json: async () => mockApiResponse(['https://foo.com/']),
            } as Response),
        );

        reconciler.fetchActorForDomain = async (domain) =>
            createMockActor(domain);

        await reconciler.run();

        const [accounts] = await pool.execute<RowDataPacket[]>(
            'SELECT COUNT(*) as count FROM accounts WHERE domain = ?',
            ['foo.com'],
        );

        expect(accounts[0].count).toBe(1);
    });

    test('it should handle malformed API response', async () => {
        await pool.execute('INSERT INTO topics (name, slug) VALUES (?, ?)', [
            'Technology',
            'technology',
        ]);

        const reconciler = new AccountTopicReconciler(
            pool,
            'https://example.com/api/sites',
            'some-api-auth-token',
        );

        global.fetch = mock(() =>
            Promise.resolve({
                ok: true,
                json: async () => ({ invalid: 'response' }),
            } as Response),
        );

        reconciler.fetchActorForDomain = async (domain) =>
            createMockActor(domain);

        await reconciler.run();

        const [accounts] = await pool.execute<RowDataPacket[]>(
            'SELECT COUNT(*) as count FROM accounts',
        );

        expect(accounts[0].count).toBe(0);
    });

    test('it should create accounts with full actor data', async () => {
        await pool.execute('INSERT INTO topics (name, slug) VALUES (?, ?)', [
            'Technology',
            'technology',
        ]);

        const reconciler = new AccountTopicReconciler(
            pool,
            'https://example.com/api/sites',
            'some-api-auth-token',
        );

        global.fetch = mock(() =>
            Promise.resolve({
                ok: true,
                json: async () => mockApiResponse(['https://foo.com/']),
            } as Response),
        );

        reconciler.fetchActorForDomain = async (domain) =>
            createMockActor(domain);

        await reconciler.run();

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
            FROM accounts WHERE domain = ?`,
            ['foo.com'],
        );

        expect(accounts.length).toBe(1);
        expect(accounts[0].username).toBe('index');
        expect(accounts[0].domain).toBe('foo.com');
        expect(accounts[0].ap_id).toBe('https://foo.com/actor');
        expect(accounts[0].name).toBe('Site at foo.com');
        expect(accounts[0].bio).toBe('Bio for foo.com');
        expect(accounts[0].avatar_url).toBe('https://foo.com/avatar.jpg');
        expect(accounts[0].banner_image_url).toBe('https://foo.com/banner.jpg');
        expect(accounts[0].url).toBe('https://foo.com/');
        expect(accounts[0].ap_inbox_url).toBe('https://foo.com/inbox');
        expect(accounts[0].ap_outbox_url).toBe('https://foo.com/outbox');
        expect(accounts[0].ap_following_url).toBe('https://foo.com/following');
        expect(accounts[0].ap_followers_url).toBe('https://foo.com/followers');
        expect(accounts[0].ap_liked_url).toBe('https://foo.com/liked');
        expect(accounts[0].ap_shared_inbox_url).toBe(
            'https://foo.com/shared-inbox',
        );

        const publicKey = JSON.parse(accounts[0].ap_public_key);
        expect(publicKey.id).toBe('https://foo.com/actor#main-key');
        expect(publicKey.owner).toBe('https://foo.com/actor');
        expect(publicKey.publicKeyPem).toBe(
            '-----BEGIN PUBLIC KEY-----\nMOCK_KEY\n-----END PUBLIC KEY-----',
        );

        expect(accounts[0].custom_fields).toEqual({
            Website: 'https://foo.com',
        });
    });

    test('it should remove site from one topic without affecting other topics', async () => {
        await pool.execute(
            'INSERT INTO topics (name, slug) VALUES (?, ?), (?, ?)',
            ['Technology', 'technology', 'Finance', 'finance'],
        );

        const reconciler = new AccountTopicReconciler(
            pool,
            'https://example.com/api/sites',
            'some-api-auth-token',
        );

        // First run: foo.com appears in BOTH topics
        global.fetch = mock((url: string) => {
            const urlObj = new URL(url);
            const category = urlObj.searchParams.get('category');

            if (category === 'technology' || category === 'finance') {
                return Promise.resolve({
                    ok: true,
                    json: async () => mockApiResponse(['https://foo.com/']),
                } as Response);
            }

            return Promise.resolve({ ok: false } as Response);
        });

        reconciler.fetchActorForDomain = async (domain) =>
            createMockActor(domain);

        await reconciler.run();

        // Verify foo.com is in both topics
        const [mappingsAfterFirst] = await pool.execute<RowDataPacket[]>(
            `SELECT t.name
             FROM account_topics at
             JOIN accounts a ON a.id = at.account_id
             JOIN topics t ON t.id = at.topic_id
             WHERE a.domain = ?
             ORDER BY t.name`,
            ['foo.com'],
        );

        expect(mappingsAfterFirst.length).toBe(2);
        expect(mappingsAfterFirst[0].name).toBe('Finance');
        expect(mappingsAfterFirst[1].name).toBe('Technology');

        // Second run: foo.com ONLY in Finance (removed from Technology)
        global.fetch = mock((url: string) => {
            const urlObj = new URL(url);
            const category = urlObj.searchParams.get('category');

            if (category === 'technology') {
                return Promise.resolve({
                    ok: true,
                    json: async () => mockApiResponse([]), // Empty!
                } as Response);
            }

            if (category === 'finance') {
                return Promise.resolve({
                    ok: true,
                    json: async () => mockApiResponse(['https://foo.com/']),
                } as Response);
            }

            return Promise.resolve({ ok: false } as Response);
        });

        await reconciler.run();

        // Verify foo.com is ONLY in Finance now
        const [mappingsAfterSecond] = await pool.execute<RowDataPacket[]>(
            `SELECT t.name
             FROM account_topics at
             JOIN accounts a ON a.id = at.account_id
             JOIN topics t ON t.id = at.topic_id
             WHERE a.domain = ?
             ORDER BY t.name`,
            ['foo.com'],
        );

        expect(mappingsAfterSecond.length).toBe(1);
        expect(mappingsAfterSecond[0].name).toBe('Finance');

        // Verify the account itself still exists (not deleted)
        const [accounts] = await pool.execute<RowDataPacket[]>(
            'SELECT COUNT(*) as count FROM accounts WHERE domain = ?',
            ['foo.com'],
        );

        expect(accounts[0].count).toBe(1);
    });

    test('it should assign rank_in_topic based on API order', async () => {
        await pool.execute('INSERT INTO topics (name, slug) VALUES (?, ?)', [
            'Technology',
            'technology',
        ]);

        const reconciler = new AccountTopicReconciler(
            pool,
            'https://example.com/api/sites',
            'some-api-auth-token',
        );

        // API returns sites in specific order
        global.fetch = mock(() =>
            Promise.resolve({
                ok: true,
                json: async () =>
                    mockApiResponse([
                        'https://first.com/',
                        'https://second.com/',
                        'https://third.com/',
                    ]),
            } as Response),
        );

        reconciler.fetchActorForDomain = async (domain) =>
            createMockActor(domain);

        await reconciler.run();

        const [mappings] = await pool.execute<RowDataPacket[]>(
            `SELECT a.domain, at.rank_in_topic
             FROM account_topics at
             JOIN accounts a ON a.id = at.account_id
             JOIN topics t ON t.id = at.topic_id
             WHERE t.slug = 'technology'
             ORDER BY at.rank_in_topic`,
        );

        expect(mappings.length).toBe(3);
        expect(mappings[0].domain).toBe('first.com');
        expect(mappings[0].rank_in_topic).toBe(1);
        expect(mappings[1].domain).toBe('second.com');
        expect(mappings[1].rank_in_topic).toBe(2);
        expect(mappings[2].domain).toBe('third.com');
        expect(mappings[2].rank_in_topic).toBe(3);
    });

    test('it should update rank_in_topic when order changes', async () => {
        await pool.execute('INSERT INTO topics (name, slug) VALUES (?, ?)', [
            'Technology',
            'technology',
        ]);

        const reconciler = new AccountTopicReconciler(
            pool,
            'https://example.com/api/sites',
            'some-api-auth-token',
        );

        // First run: initial order
        global.fetch = mock(() =>
            Promise.resolve({
                ok: true,
                json: async () =>
                    mockApiResponse([
                        'https://first.com/',
                        'https://second.com/',
                        'https://third.com/',
                    ]),
            } as Response),
        );

        reconciler.fetchActorForDomain = async (domain) =>
            createMockActor(domain);

        await reconciler.run();

        // Second run: order changed
        global.fetch = mock(() =>
            Promise.resolve({
                ok: true,
                json: async () =>
                    mockApiResponse([
                        'https://third.com/', // Now first
                        'https://first.com/', // Now second
                        'https://second.com/', // Now third
                    ]),
            } as Response),
        );

        await reconciler.run();

        const [mappings] = await pool.execute<RowDataPacket[]>(
            `SELECT a.domain, at.rank_in_topic
             FROM account_topics at
             JOIN accounts a ON a.id = at.account_id
             JOIN topics t ON t.id = at.topic_id
             WHERE t.slug = 'technology'
             ORDER BY at.rank_in_topic`,
        );

        expect(mappings.length).toBe(3);
        expect(mappings[0].domain).toBe('third.com');
        expect(mappings[0].rank_in_topic).toBe(1);
        expect(mappings[1].domain).toBe('first.com');
        expect(mappings[1].rank_in_topic).toBe(2);
        expect(mappings[2].domain).toBe('second.com');
        expect(mappings[2].rank_in_topic).toBe(3);
    });

    test('it should assign correct ranks when adding and removing sites', async () => {
        await pool.execute('INSERT INTO topics (name, slug) VALUES (?, ?)', [
            'Technology',
            'technology',
        ]);

        const reconciler = new AccountTopicReconciler(
            pool,
            'https://example.com/api/sites',
            'some-api-auth-token',
        );

        // First run: initial sites
        global.fetch = mock(() =>
            Promise.resolve({
                ok: true,
                json: async () =>
                    mockApiResponse([
                        'https://first.com/',
                        'https://second.com/',
                    ]),
            } as Response),
        );

        reconciler.fetchActorForDomain = async (domain) =>
            createMockActor(domain);

        await reconciler.run();

        // Second run: remove first.com, add third.com and fourth.com
        global.fetch = mock(() =>
            Promise.resolve({
                ok: true,
                json: async () =>
                    mockApiResponse([
                        'https://second.com/', // Still present, now rank 1
                        'https://third.com/', // New, rank 2
                        'https://fourth.com/', // New, rank 3
                    ]),
            } as Response),
        );

        await reconciler.run();

        const [mappings] = await pool.execute<RowDataPacket[]>(
            `SELECT a.domain, at.rank_in_topic
             FROM account_topics at
             JOIN accounts a ON a.id = at.account_id
             JOIN topics t ON t.id = at.topic_id
             WHERE t.slug = 'technology'
             ORDER BY at.rank_in_topic`,
        );

        expect(mappings.length).toBe(3);
        expect(mappings[0].domain).toBe('second.com');
        expect(mappings[0].rank_in_topic).toBe(1);
        expect(mappings[1].domain).toBe('third.com');
        expect(mappings[1].rank_in_topic).toBe(2);
        expect(mappings[2].domain).toBe('fourth.com');
        expect(mappings[2].rank_in_topic).toBe(3);

        // Verify first.com was removed
        const [removedAccount] = await pool.execute<RowDataPacket[]>(
            `SELECT COUNT(*) as count
             FROM account_topics at
             JOIN accounts a ON a.id = at.account_id
             WHERE a.domain = 'first.com'`,
        );

        expect(removedAccount[0].count).toBe(0);
    });

    test('it should assign ranks across multiple topics independently', async () => {
        await pool.execute(
            'INSERT INTO topics (name, slug) VALUES (?, ?), (?, ?)',
            ['Technology', 'technology', 'Finance', 'finance'],
        );

        const reconciler = new AccountTopicReconciler(
            pool,
            'https://example.com/api/sites',
            'some-api-auth-token',
        );

        global.fetch = mock((url: string) => {
            const urlObj = new URL(url);
            const category = urlObj.searchParams.get('category');

            if (category === 'technology') {
                return Promise.resolve({
                    ok: true,
                    json: async () =>
                        mockApiResponse([
                            'https://foo.com/', // Rank 1 in Technology
                            'https://bar.com/', // Rank 2 in Technology
                        ]),
                } as Response);
            }

            if (category === 'finance') {
                return Promise.resolve({
                    ok: true,
                    json: async () =>
                        mockApiResponse([
                            'https://bar.com/', // Rank 1 in Finance (different from Technology!)
                            'https://baz.com/', // Rank 2 in Finance
                        ]),
                } as Response);
            }

            return Promise.resolve({ ok: false } as Response);
        });

        reconciler.fetchActorForDomain = async (domain) =>
            createMockActor(domain);

        await reconciler.run();

        const [mappings] = await pool.execute<RowDataPacket[]>(
            `SELECT a.domain, t.name, at.rank_in_topic
             FROM account_topics at
             JOIN accounts a ON a.id = at.account_id
             JOIN topics t ON t.id = at.topic_id
             ORDER BY t.name, at.rank_in_topic`,
        );

        expect(mappings.length).toBe(4);

        // Finance topic
        expect(mappings[0].name).toBe('Finance');
        expect(mappings[0].domain).toBe('bar.com');
        expect(mappings[0].rank_in_topic).toBe(1);

        expect(mappings[1].name).toBe('Finance');
        expect(mappings[1].domain).toBe('baz.com');
        expect(mappings[1].rank_in_topic).toBe(2);

        // Technology topic
        expect(mappings[2].name).toBe('Technology');
        expect(mappings[2].domain).toBe('foo.com');
        expect(mappings[2].rank_in_topic).toBe(1);

        expect(mappings[3].name).toBe('Technology');
        expect(mappings[3].domain).toBe('bar.com');
        expect(mappings[3].rank_in_topic).toBe(2);
    });
});
