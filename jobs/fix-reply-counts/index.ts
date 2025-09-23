#!/usr/bin/env bun

import mysql from 'mysql2/promise';

const POOL_SIZE = 10;
const BATCH_SIZE = 100;
const DELAY_BETWEEN_BATCHES_MS = 100;
const CUTOFF_DATE = '2025-07-24';

interface PostToFix {
    id: number;
    current_count: number;
    real_count: number;
}

export async function findPostsToFix(
    pool: mysql.Pool,
    cutoffDate: string,
    batchSize: number,
    fixZeroOnly: boolean = false,
): Promise<PostToFix[]> {
    const fixZeroOnlyQuery = `SELECT
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
        LIMIT ${batchSize}`;

    const fixAllMismatchesQuery = `SELECT
            p.id,
            p.reply_count AS current_count,
            COUNT(replies.id) AS real_count
        FROM posts p
        LEFT JOIN posts replies
            ON replies.in_reply_to = p.id
            AND replies.deleted_at IS NULL
        WHERE p.created_at < ?
        AND p.deleted_at IS NULL
        GROUP BY p.id, p.reply_count
        HAVING p.reply_count != COUNT(replies.id)
        LIMIT ${batchSize}`;

    const query = fixZeroOnly ? fixZeroOnlyQuery : fixAllMismatchesQuery;

    const [rows] = await pool.execute<mysql.RowDataPacket[]>(query, [
        cutoffDate,
    ]);

    return rows as PostToFix[];
}

export async function updatePostReplyCount(
    pool: mysql.Pool,
    postId: number,
    oldCount: number,
    newCount: number,
): Promise<boolean> {
    const [result] = await pool.execute<mysql.ResultSetHeader>(
        'UPDATE posts SET reply_count = ? WHERE id = ? AND reply_count = ?',
        [newCount, postId, oldCount],
    );

    return result.affectedRows === 1;
}

interface FixOptions {
    cutoffDate?: string;
    batchSize?: number;
    delayMs?: number;
    verbose?: boolean;
    fixZeroOnly?: boolean;
    dryRun?: boolean;
}

export async function fixReplyCountsInBatches(
    pool: mysql.Pool,
    options: FixOptions = {},
): Promise<number> {
    const {
        cutoffDate = CUTOFF_DATE,
        batchSize = BATCH_SIZE,
        delayMs = DELAY_BETWEEN_BATCHES_MS,
        verbose = true,
        fixZeroOnly = false,
        dryRun = false,
    } = options;
    let totalFixed = 0;
    let batchNumber = 0;
    let hasMore = true;

    while (hasMore) {
        batchNumber++;

        const posts = await findPostsToFix(
            pool,
            cutoffDate,
            batchSize,
            fixZeroOnly,
        );

        if (posts.length === 0) {
            hasMore = false;
            break;
        }

        if (verbose) {
            console.log(
                `Batch ${batchNumber}: Found ${posts.length} posts to fix`,
            );
        }

        if (dryRun) {
            if (verbose) {
                posts.forEach((post) => {
                    console.log(
                        `  - [DRY RUN] Would fix Post ${post.id}: ${post.current_count} → ${post.real_count}`,
                    );
                });
            }
            totalFixed += posts.length;
        } else {
            const updatePromises = posts.map((post) =>
                updatePostReplyCount(
                    pool,
                    post.id,
                    post.current_count,
                    post.real_count,
                ).then((success) => {
                    if (success) {
                        if (verbose) {
                            console.log(
                                `  - Post ${post.id}: ${post.current_count} → ${post.real_count}`,
                            );
                        }
                        return true;
                    } else {
                        if (verbose) {
                            console.log(
                                `  - Post ${post.id}: Skipped (reply_count already changed)`,
                            );
                        }
                        return false;
                    }
                }),
            );

            const results = await Promise.all(updatePromises);
            const successCount = results.filter(Boolean).length;
            totalFixed += successCount;
        }

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
    const args = process.argv.slice(2);
    const flags = {
        dryRun: args.includes('--dry-run'),
        fixZeroOnly: args.includes('--fix-zero-only'),
        quiet: args.includes('--quiet'),
    };

    const pool = mysql.createPool({
        connectionLimit: POOL_SIZE,
        ...(process.env.DB_SOCKET_PATH
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
              }),
    });

    try {
        console.log(`Starting fix for reply_count discrepancies...`);
        console.log(`Targeting posts created before ${CUTOFF_DATE}`);
        console.log(
            `Mode: ${flags.fixZeroOnly ? 'Fix only reply_count = 0' : 'Fix ALL mismatches (default)'}`,
        );
        console.log(`Batch size: ${BATCH_SIZE}`);
        console.log(`Delay between batches: ${DELAY_BETWEEN_BATCHES_MS}ms`);

        if (flags.dryRun) {
            console.log(`\n⚠️  DRY RUN MODE - No changes will be made`);
        }

        console.log('---');

        const totalFixed = await fixReplyCountsInBatches(pool, {
            verbose: !flags.quiet,
            fixZeroOnly: flags.fixZeroOnly,
            dryRun: flags.dryRun,
        });

        console.log('---');
        console.log(`✓ Completed! Fixed ${totalFixed} posts`);
    } catch (error) {
        console.error('Error fixing reply counts:', error);

        process.exit(1);
    } finally {
        await pool.end();
    }
}

if (import.meta.main) {
    main().catch((error) => {
        console.error('Unhandled error:', error);

        process.exit(1);
    });
}
