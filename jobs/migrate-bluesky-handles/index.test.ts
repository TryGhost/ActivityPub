import { file, SQL } from 'bun';

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import {
    getAccountsFollowingBridgy,
    saveBlueskyHandle,
    searchBlueskyHandle,
} from './index';

describe('searchBlueskyHandle', () => {
    it('should return handle when actor with .ap.brid.gy handle is found', async () => {
        const mockResponse = {
            actors: [
                {
                    did: 'did:plc:example',
                    handle: 'example.com.ap.brid.gy',
                    displayName: 'Example Site',
                },
            ],
        };

        global.fetch = mock(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve(mockResponse),
            }),
        ) as unknown as typeof fetch;

        const result = await searchBlueskyHandle('example.com');

        expect(result).toBe('example.com.ap.brid.gy');
        expect(global.fetch).toHaveBeenCalledWith(
            'https://public.api.bsky.app/xrpc/app.bsky.actor.searchActors?q=example.com',
            {
                headers: {
                    Accept: 'application/json',
                },
            },
        );
    });

    it('should return null when no matching actor is found', async () => {
        const mockResponse = {
            actors: [
                {
                    did: 'did:plc:other',
                    handle: 'other.bsky.social',
                    displayName: 'Other User',
                },
            ],
        };

        global.fetch = mock(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve(mockResponse),
            }),
        ) as unknown as typeof fetch;

        const result = await searchBlueskyHandle('example.com');

        expect(result).toBeNull();
    });

    it('should return null when API returns empty actors array', async () => {
        const mockResponse = {
            actors: [],
        };

        global.fetch = mock(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve(mockResponse),
            }),
        ) as unknown as typeof fetch;

        const result = await searchBlueskyHandle('example.com');

        expect(result).toBeNull();
    });

    it('should throw error when API returns non-200 status', async () => {
        global.fetch = mock(() =>
            Promise.resolve({
                ok: false,
                status: 500,
            }),
        ) as unknown as typeof fetch;

        await expect(searchBlueskyHandle('example.com')).rejects.toThrow(
            'Bluesky API returned status 500 for example.com',
        );
    });

    it('should match handle with exact hostname', async () => {
        const mockResponse = {
            actors: [
                {
                    did: 'did:plc:example',
                    handle: 'www.example.com.ap.brid.gy',
                    displayName: 'Example Site',
                },
            ],
        };

        global.fetch = mock(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve(mockResponse),
            }),
        ) as unknown as typeof fetch;

        const result = await searchBlueskyHandle('www.example.com');

        expect(result).toBe('www.example.com.ap.brid.gy');
    });

    it('should not match handles that contain hostname but are not bridgy handles', async () => {
        const mockResponse = {
            actors: [
                {
                    did: 'did:plc:example',
                    handle: 'example.com.otherdomain.com',
                    displayName: 'Example Site',
                },
            ],
        };

        global.fetch = mock(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve(mockResponse),
            }),
        ) as unknown as typeof fetch;

        const result = await searchBlueskyHandle('example.com');

        expect(result).toBeNull();
    });
});

describe('getAccountsFollowingBridgy', () => {
    let sql: SQL;
    let dbPath: string;

    beforeEach(async () => {
        const randomId = crypto.randomUUID().substring(0, 8);

        dbPath = `/tmp/test-${randomId}.db`;
        sql = new SQL({
            adapter: 'sqlite',
            filename: dbPath,
        });

        await sql`
            CREATE TABLE accounts (
                id INTEGER PRIMARY KEY,
                domain TEXT NOT NULL
            )
        `;
        await sql`
            CREATE TABLE follows (
                id INTEGER PRIMARY KEY,
                follower_id INTEGER NOT NULL,
                following_id INTEGER NOT NULL,
                FOREIGN KEY (follower_id) REFERENCES accounts(id),
                FOREIGN KEY (following_id) REFERENCES accounts(id)
            )
        `;
        await sql`INSERT INTO accounts (id, domain) VALUES (1, 'site1.com')`;
        await sql`INSERT INTO accounts (id, domain) VALUES (2, 'site2.com')`;
        await sql`INSERT INTO accounts (id, domain) VALUES (123, 'bridgy.com')`;
        await sql`INSERT INTO follows (follower_id, following_id) VALUES (1, 123)`;
        await sql`INSERT INTO follows (follower_id, following_id) VALUES (2, 123)`;
    });

    afterEach(async () => {
        const dbFile = file(dbPath);
        if (await dbFile.exists()) {
            await dbFile.delete();
        }
    });

    it('should get accounts following bridgy account', async () => {
        const result = await getAccountsFollowingBridgy(sql, 123);

        expect(result).toEqual([
            { account_id: 1, domain: 'site1.com' },
            { account_id: 2, domain: 'site2.com' },
        ]);
    });
});

describe('saveBlueskyHandle', () => {
    let sql: SQL;
    let dbPath: string;

    beforeEach(async () => {
        const randomId = crypto.randomUUID().substring(0, 8);
        dbPath = `/tmp/test-${randomId}.db`;
        sql = new SQL({
            adapter: 'sqlite',
            filename: dbPath,
        });

        await sql`
            CREATE TABLE accounts (
                id INTEGER PRIMARY KEY,
                domain TEXT NOT NULL
            )
        `;
        await sql`
            CREATE TABLE bluesky_integration_account_handles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id INTEGER NOT NULL UNIQUE,
                handle TEXT NOT NULL UNIQUE,
                FOREIGN KEY (account_id) REFERENCES accounts(id)
            )
        `;
        await sql`INSERT INTO accounts (id, domain) VALUES (123, 'example.com')`;
    });

    afterEach(async () => {
        const dbFile = file(dbPath);

        if (await dbFile.exists()) {
            await dbFile.delete();
        }
    });

    it('should insert a new handle mapping', async () => {
        await saveBlueskyHandle(sql, 123, 'example.com.ap.brid.gy');

        const result = await sql`
            SELECT * FROM bluesky_integration_account_handles
            WHERE account_id = 123
        `;

        expect(result.length).toBe(1);
        expect(result[0].account_id).toBe(123);
        expect(result[0].handle).toBe('example.com.ap.brid.gy');
    });

    it('should update an existing handle mapping', async () => {
        await sql`
            INSERT INTO bluesky_integration_account_handles (account_id, handle)
            VALUES (123, 'old.handle.ap.brid.gy')
        `;

        await saveBlueskyHandle(sql, 123, 'new.handle.ap.brid.gy');

        const result = await sql`
            SELECT * FROM bluesky_integration_account_handles
            WHERE account_id = 123
        `;

        expect(result.length).toBe(1);
        expect(result[0].handle).toBe('new.handle.ap.brid.gy');
    });
});
