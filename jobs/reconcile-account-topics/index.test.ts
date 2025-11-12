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
                FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
                FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE,
                UNIQUE KEY unique_account_topic (account_id, topic_id)
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
            data: urls,
            links: {
                first: 'https://api.example.com/some-api/?page=1',
                last: 'https://api.example.com/some-api/?page=1',
                prev: null,
                next: hasNext
                    ? 'https://api.example.com/some-api/?page=2'
                    : null,
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
        const reconciler = new AccountTopicReconciler(pool);

        await reconciler.run();

        const [accounts] = await pool.execute<RowDataPacket[]>(
            'SELECT COUNT(*) as count FROM accounts',
        );

        expect(accounts[0].count).toBe(0);
    });

    test('it should fetch URLs from API and create accounts', async () => {
        await pool.execute(
            'INSERT INTO topics (name, slug) VALUES (?, ?), (?, ?)',
            ['Technology', 'technology', 'Finance', 'finance'],
        );

        const reconciler = new AccountTopicReconciler(pool);

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

        const reconciler = new AccountTopicReconciler(pool);

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

        const reconciler = new AccountTopicReconciler(pool);

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

        const reconciler = new AccountTopicReconciler(pool);

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

        const reconciler = new AccountTopicReconciler(pool);

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

        const reconciler = new AccountTopicReconciler(pool);

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

        const reconciler = new AccountTopicReconciler(pool);

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

        const reconciler = new AccountTopicReconciler(pool);

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

        const reconciler = new AccountTopicReconciler(pool);

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

        const reconciler = new AccountTopicReconciler(pool);

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

        const reconciler = new AccountTopicReconciler(pool);

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

        const reconciler = new AccountTopicReconciler(pool);

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
});
