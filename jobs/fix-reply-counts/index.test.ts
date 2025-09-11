import mysql from 'mysql2/promise';

import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    test,
} from 'bun:test';
import {
    findPostsToFix,
    fixReplyCountsInBatches,
    updatePostReplyCount,
} from './index';

describe('fix-reply-counts job', () => {
    let connection: mysql.Connection;
    let testAccountId: number;

    beforeAll(async () => {
        for (let i = 0; i < 10; i++) {
            try {
                connection = await mysql.createConnection({
                    host: 'localhost',
                    port: 3308,
                    user: 'root',
                    password: 'root',
                    database: 'fix_reply_job',
                });
                break;
            } catch (error) {
                if (i === 9) throw error;
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        }

        await connection.execute(`
            CREATE TABLE IF NOT EXISTS accounts (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(255),
                domain VARCHAR(255),
                is_internal BOOLEAN
            )
        `);

        await connection.execute(`
            CREATE TABLE IF NOT EXISTS posts (
                id INT AUTO_INCREMENT PRIMARY KEY,
                author_id INT,
                content TEXT,
                url VARCHAR(1024),
                ap_id VARCHAR(1024),
                in_reply_to INT NULL,
                reply_count INT DEFAULT 0,
                created_at DATETIME,
                deleted_at DATETIME NULL,
                FOREIGN KEY (author_id) REFERENCES accounts(id)
            )
        `);
    });

    afterAll(async () => {
        await connection.execute('DROP TABLE IF EXISTS posts');
        await connection.execute('DROP TABLE IF EXISTS accounts');
        await connection.end();
    });

    beforeEach(async () => {
        await connection.execute('DELETE FROM posts');
        await connection.execute('DELETE FROM accounts');

        const [accountResult] = await connection.execute(
            'INSERT INTO accounts (username, domain, is_internal) VALUES (?, ?, ?)',
            ['testuser', 'example.com', 1],
        );
        testAccountId = (accountResult as any).insertId;
    });

    test('findPostsToFix finds posts with reply_count=0 that have active replies', async () => {
        const [parentPost] = await connection.execute(
            `INSERT INTO posts (author_id, content, url, ap_id, created_at, reply_count)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                testAccountId,
                'Parent post',
                'http://example.com/1',
                'http://example.com/1',
                '2025-07-20',
                0,
            ],
        );
        const parentId = (parentPost as any).insertId;

        await connection.execute(
            `INSERT INTO posts (author_id, content, url, ap_id, in_reply_to, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                testAccountId,
                'Reply 1',
                'http://example.com/r1',
                'http://example.com/r1',
                parentId,
                '2025-07-21',
            ],
        );
        await connection.execute(
            `INSERT INTO posts (author_id, content, url, ap_id, in_reply_to, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                testAccountId,
                'Reply 2',
                'http://example.com/r2',
                'http://example.com/r2',
                parentId,
                '2025-07-21',
            ],
        );

        const posts = await findPostsToFix(connection, '2025-07-24', 100);

        expect(posts.length).toBe(1);
        expect(posts[0].id).toBe(parentId);
        expect(posts[0].current_count).toBe(0);
        expect(posts[0].real_count).toBe(2);
    });

    test('findPostsToFix ignores deleted replies when counting', async () => {
        const [parentPost] = await connection.execute(
            `INSERT INTO posts (author_id, content, url, ap_id, created_at, reply_count)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                testAccountId,
                'Parent post',
                'http://example.com/1',
                'http://example.com/1',
                '2025-07-20',
                0,
            ],
        );
        const parentId = (parentPost as any).insertId;

        await connection.execute(
            `INSERT INTO posts (author_id, content, url, ap_id, in_reply_to, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                testAccountId,
                'Active Reply',
                'http://example.com/r1',
                'http://example.com/r1',
                parentId,
                '2025-07-21',
            ],
        );
        await connection.execute(
            `INSERT INTO posts (author_id, content, url, ap_id, in_reply_to, created_at, deleted_at)
             VALUES (?, ?, ?, ?, ?, ?, NOW())`,
            [
                testAccountId,
                'Deleted Reply',
                'http://example.com/r2',
                'http://example.com/r2',
                parentId,
                '2025-07-21',
            ],
        );

        const posts = await findPostsToFix(connection, '2025-07-24', 100);

        expect(posts.length).toBe(1);
        expect(posts[0].real_count).toBe(1);
    });

    test('findPostsToFix ignores posts created after cutoff date', async () => {
        const [parentPost] = await connection.execute(
            `INSERT INTO posts (author_id, content, url, ap_id, created_at, reply_count)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                testAccountId,
                'Parent post',
                'http://example.com/1',
                'http://example.com/1',
                '2025-07-25',
                0,
            ],
        );
        const parentId = (parentPost as any).insertId;

        await connection.execute(
            `INSERT INTO posts (author_id, content, url, ap_id, in_reply_to, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                testAccountId,
                'Reply',
                'http://example.com/r1',
                'http://example.com/r1',
                parentId,
                '2025-07-26',
            ],
        );

        const posts = await findPostsToFix(connection, '2025-07-24', 100);

        expect(posts.length).toBe(0);
    });

    test('findPostsToFix ignores posts that already have correct reply_count', async () => {
        const [parentPost] = await connection.execute(
            `INSERT INTO posts (author_id, content, url, ap_id, created_at, reply_count)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                testAccountId,
                'Parent post',
                'http://example.com/1',
                'http://example.com/1',
                '2025-07-20',
                1,
            ],
        );
        const parentId = (parentPost as any).insertId;

        await connection.execute(
            `INSERT INTO posts (author_id, content, url, ap_id, in_reply_to, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                testAccountId,
                'Reply',
                'http://example.com/r1',
                'http://example.com/r1',
                parentId,
                '2025-07-21',
            ],
        );

        const posts = await findPostsToFix(connection, '2025-07-24', 100);

        expect(posts.length).toBe(0);
    });

    test('updatePostReplyCount updates the reply count correctly', async () => {
        const [parentPost] = await connection.execute(
            `INSERT INTO posts (author_id, content, url, ap_id, created_at, reply_count)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                testAccountId,
                'Parent post',
                'http://example.com/1',
                'http://example.com/1',
                '2025-07-20',
                0,
            ],
        );
        const parentId = (parentPost as any).insertId;

        await updatePostReplyCount(connection, parentId, 5);

        const [updated] = await connection.execute<mysql.RowDataPacket[]>(
            'SELECT reply_count FROM posts WHERE id = ?',
            [parentId],
        );
        expect((updated as any[])[0].reply_count).toBe(5);
    });

    test('updatePostReplyCount does not update if reply_count is not 0 (race condition protection)', async () => {
        const [parentPost] = await connection.execute(
            `INSERT INTO posts (author_id, content, url, ap_id, created_at, reply_count)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                testAccountId,
                'Parent post',
                'http://example.com/1',
                'http://example.com/1',
                '2025-07-20',
                3,
            ],
        );
        const parentId = (parentPost as any).insertId;

        await updatePostReplyCount(connection, parentId, 5);

        const [notUpdated] = await connection.execute<mysql.RowDataPacket[]>(
            'SELECT reply_count FROM posts WHERE id = ?',
            [parentId],
        );
        expect((notUpdated as any[])[0].reply_count).toBe(3);
    });

    test('fixReplyCountsInBatches is idempotent', async () => {
        const [parentPost] = await connection.execute(
            `INSERT INTO posts (author_id, content, url, ap_id, created_at, reply_count)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                testAccountId,
                'Parent post',
                'http://example.com/1',
                'http://example.com/1',
                '2025-07-20',
                0,
            ],
        );
        const parentId = (parentPost as any).insertId;

        await connection.execute(
            `INSERT INTO posts (author_id, content, url, ap_id, in_reply_to, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                testAccountId,
                'Reply',
                'http://example.com/r1',
                'http://example.com/r1',
                parentId,
                '2025-07-21',
            ],
        );

        const firstRunCount = await fixReplyCountsInBatches(
            connection,
            '2025-07-24',
            100,
            0,
            false,
        );
        expect(firstRunCount).toBe(1);

        const [afterFirst] = await connection.execute<mysql.RowDataPacket[]>(
            'SELECT reply_count FROM posts WHERE id = ?',
            [parentId],
        );
        expect((afterFirst as any[])[0].reply_count).toBe(1);

        const secondRunCount = await fixReplyCountsInBatches(
            connection,
            '2025-07-24',
            100,
            0,
            false,
        );
        expect(secondRunCount).toBe(0);

        const [afterSecond] = await connection.execute<mysql.RowDataPacket[]>(
            'SELECT reply_count FROM posts WHERE id = ?',
            [parentId],
        );
        expect((afterSecond as any[])[0].reply_count).toBe(1);
    });

    test('fixReplyCountsInBatches respects batch size', async () => {
        for (let i = 0; i < 5; i++) {
            const [parentPost] = await connection.execute(
                `INSERT INTO posts (author_id, content, url, ap_id, created_at, reply_count)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    testAccountId,
                    `Parent ${i}`,
                    `http://example.com/p${i}`,
                    `http://example.com/p${i}`,
                    '2025-07-20',
                    0,
                ],
            );
            const parentId = (parentPost as any).insertId;

            await connection.execute(
                `INSERT INTO posts (author_id, content, url, ap_id, in_reply_to, created_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    testAccountId,
                    `Reply to ${i}`,
                    `http://example.com/r${i}`,
                    `http://example.com/r${i}`,
                    parentId,
                    '2025-07-21',
                ],
            );
        }

        const totalFixed = await fixReplyCountsInBatches(
            connection,
            '2025-07-24',
            2,
            0,
            false,
        );
        expect(totalFixed).toBe(5);
    });
});
