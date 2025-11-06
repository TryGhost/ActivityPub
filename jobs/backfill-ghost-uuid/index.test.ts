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

import mysql, { type RowDataPacket } from 'mysql2/promise';

import {
    fetchSiteGhostUUID,
    getSitesWithoutGhostUUID,
    updateSiteGhostUUID,
} from './index';

describe('backfill-ghost-uuid', () => {
    let connection: mysql.Connection;
    let originalFetch: typeof global.fetch;

    beforeAll(async () => {
        connection = await mysql.createConnection({
            host: 'localhost',
            port: 3308,
            user: 'root',
            password: 'root',
            database: 'backfill-ghost-uuid',
        });

        await connection.execute(`
            CREATE TABLE IF NOT EXISTS sites (
                id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                host VARCHAR(255) NOT NULL UNIQUE,
                webhook_secret VARCHAR(64) NOT NULL UNIQUE,
                ghost_uuid CHAR(36) NULL UNIQUE
            )
        `);

        originalFetch = global.fetch;
    });

    afterAll(async () => {
        await connection.execute('DROP TABLE IF EXISTS sites');
        await connection.end();
    });

    beforeEach(async () => {
        await connection.execute('DELETE FROM sites');
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    describe('fetchSiteGhostUUID', () => {
        test('should fetch the UUID from a site', async () => {
            global.fetch = mock(() =>
                Promise.resolve({
                    ok: true,
                    json: async () => ({
                        site: {
                            title: 'Test Site',
                            site_uuid: '506b2854-7d2d-40a4-98bd-ed0fb21fc4b2',
                        },
                    }),
                } as Response),
            );

            const uuid = await fetchSiteGhostUUID('example.com');

            expect(uuid).toBe('506b2854-7d2d-40a4-98bd-ed0fb21fc4b2');
        });

        test('should return null on HTTP error', async () => {
            global.fetch = mock(() =>
                Promise.resolve({
                    ok: false,
                    status: 404,
                } as Response),
            );

            const uuid = await fetchSiteGhostUUID('example.com');

            expect(uuid).toBeNull();
        });

        test('should return null on 500 error', async () => {
            global.fetch = mock(() =>
                Promise.resolve({
                    ok: false,
                    status: 500,
                } as Response),
            );

            const uuid = await fetchSiteGhostUUID('example.com');

            expect(uuid).toBeNull();
        });

        test('should return null on malformed JSON response', async () => {
            global.fetch = mock(() =>
                Promise.resolve({
                    ok: true,
                    json: async () => ({
                        invalid: 'response',
                    }),
                } as Response),
            );

            const uuid = await fetchSiteGhostUUID('example.com');

            expect(uuid).toBeNull();
        });

        test('should return null when site_uuid is missing', async () => {
            global.fetch = mock(() =>
                Promise.resolve({
                    ok: true,
                    json: async () => ({
                        site: {
                            title: 'Test Site',
                        },
                    }),
                } as Response),
            );

            const uuid = await fetchSiteGhostUUID('example.com');

            expect(uuid).toBeNull();
        });

        test('should return null on network error', async () => {
            global.fetch = mock(() =>
                Promise.reject(new Error('Network error')),
            );

            const uuid = await fetchSiteGhostUUID('example.com');

            expect(uuid).toBeNull();
        });

        test('should use correct URL format', async () => {
            const mockFetch = mock(() =>
                Promise.resolve({
                    ok: true,
                    json: async () => ({
                        site: {
                            site_uuid: '506b2854-7d2d-40a4-98bd-ed0fb21fc4b2',
                        },
                    }),
                } as Response),
            );

            global.fetch = mockFetch;

            await fetchSiteGhostUUID('example.com');

            expect(mockFetch).toHaveBeenCalledWith(
                'https://example.com/ghost/api/admin/site/',
                {
                    headers: {
                        Accept: 'application/json',
                    },
                    signal: expect.any(AbortSignal),
                },
            );
        });
    });

    describe('getSitesWithoutGhostUUID', () => {
        test('should return sites without ghost_uuid', async () => {
            await connection.execute(
                'INSERT INTO sites (host, webhook_secret, ghost_uuid) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)',
                [
                    'site1.com',
                    'secret1',
                    null,
                    'site2.com',
                    'secret2',
                    '506b2854-7d2d-40a4-98bd-ed0fb21fc4b2',
                    'site3.com',
                    'secret3',
                    null,
                ],
            );

            const sites = await getSitesWithoutGhostUUID(connection);

            expect(sites.length).toBe(2);
            expect(sites[0].host).toBe('site1.com');
            expect(sites[1].host).toBe('site3.com');
        });

        test('should return empty array when all sites have ghost_uuid', async () => {
            await connection.execute(
                'INSERT INTO sites (host, webhook_secret, ghost_uuid) VALUES (?, ?, ?)',
                [
                    'site1.com',
                    'secret1',
                    '506b2854-7d2d-40a4-98bd-ed0fb21fc4b2',
                ],
            );

            const sites = await getSitesWithoutGhostUUID(connection);

            expect(sites.length).toBe(0);
        });

        test('should return empty array when no sites exist', async () => {
            const sites = await getSitesWithoutGhostUUID(connection);

            expect(sites.length).toBe(0);
        });

        test('should return sites in order by id', async () => {
            await connection.execute(
                'INSERT INTO sites (host, webhook_secret, ghost_uuid) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)',
                [
                    'site3.com',
                    'secret3',
                    null,
                    'site1.com',
                    'secret1',
                    null,
                    'site2.com',
                    'secret2',
                    null,
                ],
            );

            const sites = await getSitesWithoutGhostUUID(connection);

            expect(sites.length).toBe(3);
            expect(sites[0].host).toBe('site3.com');
            expect(sites[1].host).toBe('site1.com');
            expect(sites[2].host).toBe('site2.com');
        });
    });

    describe('updateSiteGhostUUID', () => {
        test("should update a site's ghost_uuid", async () => {
            await connection.execute(
                'INSERT INTO sites (host, webhook_secret, ghost_uuid) VALUES (?, ?, ?)',
                ['site1.com', 'secret1', null],
            );

            const [rows] = await connection.execute<RowDataPacket[]>(
                'SELECT id FROM sites WHERE host = ?',
                ['site1.com'],
            );

            const siteId = rows[0].id;

            await updateSiteGhostUUID(
                connection,
                siteId,
                '506b2854-7d2d-40a4-98bd-ed0fb21fc4b2',
            );

            const [updated] = await connection.execute<RowDataPacket[]>(
                'SELECT ghost_uuid FROM sites WHERE id = ?',
                [siteId],
            );

            expect(updated[0].ghost_uuid).toBe(
                '506b2854-7d2d-40a4-98bd-ed0fb21fc4b2',
            );
        });

        test('should update existing ghost_uuid', async () => {
            await connection.execute(
                'INSERT INTO sites (host, webhook_secret, ghost_uuid) VALUES (?, ?, ?)',
                ['site1.com', 'secret1', 'old-uuid'],
            );

            const [rows] = await connection.execute<RowDataPacket[]>(
                'SELECT id FROM sites WHERE host = ?',
                ['site1.com'],
            );

            const siteId = rows[0].id;

            await updateSiteGhostUUID(
                connection,
                siteId,
                '506b2854-7d2d-40a4-98bd-ed0fb21fc4b2',
            );

            const [updated] = await connection.execute<RowDataPacket[]>(
                'SELECT ghost_uuid FROM sites WHERE id = ?',
                [siteId],
            );

            expect(updated[0].ghost_uuid).toBe(
                '506b2854-7d2d-40a4-98bd-ed0fb21fc4b2',
            );
        });
    });
});
