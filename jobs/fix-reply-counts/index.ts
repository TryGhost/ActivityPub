#!/usr/bin/env bun

import mysql from 'mysql2/promise';

const BATCH_SIZE = 100;
const DELAY_BETWEEN_BATCHES_MS = 100;
const CUTOFF_DATE = '2025-07-24';

interface PostToFix {
    id: number;
    current_count: number;
    real_count: number;
}

export async function findPostsToFix(
    connection: mysql.Connection,
    cutoffDate: string,
    batchSize: number,
): Promise<PostToFix[]> {
    const [rows] = await connection.execute<mysql.RowDataPacket[]>(
        `SELECT
            p.id,
            p.reply_count AS current_count,
            COUNT(replies.id) AS real_count
        FROM posts p
        LEFT JOIN posts replies
            ON replies.in_reply_to = p.id
            AND replies.deleted_at IS NULL
        WHERE p.created_at < ?
        AND p.deleted_at IS NULL
        AND p.reply_count = 0
        GROUP BY p.id, p.reply_count
        HAVING COUNT(replies.id) > 0
        LIMIT ${batchSize}`,
        [cutoffDate],
    );

    return rows as PostToFix[];
}

export async function updatePostReplyCount(
    connection: mysql.Connection,
    postId: number,
    replyCount: number,
): Promise<void> {
    await connection.execute(
        'UPDATE posts SET reply_count = ? WHERE id = ? AND reply_count = 0',
        [replyCount, postId],
    );
}

export async function fixReplyCountsInBatches(
    connection: mysql.Connection,
    cutoffDate: string = CUTOFF_DATE,
    batchSize: number = BATCH_SIZE,
    delayMs: number = DELAY_BETWEEN_BATCHES_MS,
    verbose: boolean = true,
): Promise<number> {
    let totalFixed = 0;
    let batchNumber = 0;
    let hasMore = true;

    while (hasMore) {
        batchNumber++;

        const posts = await findPostsToFix(connection, cutoffDate, batchSize);

        if (posts.length === 0) {
            hasMore = false;
            break;
        }

        if (verbose) {
            console.log(
                `Batch ${batchNumber}: Found ${posts.length} posts to fix`,
            );
        }

        const updatePromises = posts.map((post) =>
            updatePostReplyCount(connection, post.id, post.real_count).then(
                () => {
                    if (verbose) {
                        console.log(
                            `  - Post ${post.id}: ${post.current_count} → ${post.real_count}`,
                        );
                    }
                },
            ),
        );

        await Promise.all(updatePromises);

        totalFixed += posts.length;

        if (verbose) {
            console.log(
                `Batch ${batchNumber} complete. Total fixed so far: ${totalFixed}`,
            );
        }

        if (posts.length < batchSize) {
            hasMore = false;
        } else {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }

    return totalFixed;
}

async function main() {
    const connection = await mysql.createConnection(
        process.env.DB_SOCKET_PATH
            ? {
                  socketPath: process.env.DB_SOCKET_PATH,
                  user: process.env.DB_USER,
                  password: process.env.DB_PASSWORD,
                  database: process.env.DB_NAME,
              }
            : {
                  host: process.env.DB_HOST,
                  port: Number.parseInt(process.env.DB_PORT || '3306'),
                  user: process.env.DB_USER,
                  password: process.env.DB_PASSWORD,
                  database: process.env.DB_NAME,
              },
    );

    try {
        console.log(`Starting fix for reply_count discrepancies...`);
        console.log(
            `Targeting posts created before ${CUTOFF_DATE} with reply_count = 0`,
        );
        console.log(`Batch size: ${BATCH_SIZE}`);
        console.log(`Delay between batches: ${DELAY_BETWEEN_BATCHES_MS}ms`);
        console.log('---');

        const totalFixed = await fixReplyCountsInBatches(connection);

        console.log('---');
        console.log(`✓ Completed! Fixed ${totalFixed} posts`);
    } catch (error) {
        console.error('Error fixing reply counts:', error);

        process.exit(1);
    } finally {
        await connection.end();
    }
}

if (import.meta.main) {
    main().catch((error) => {
        console.error('Unhandled error:', error);

        process.exit(1);
    });
}
