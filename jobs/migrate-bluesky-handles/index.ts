#!/usr/bin/env bun

/**
 * We can't use Bun.SQL because it doesn't like using a socket :(
 */
import mysql from 'mysql2/promise';

interface BlueskyActor {
    did: string;
    handle: string;
    displayName?: string;
    description?: string;
}

interface BlueskySearchResponse {
    actors: BlueskyActor[];
}

/**
 * @see https://docs.bsky.app/docs/api/app-bsky-actor-search-actors
 * @see https://public.api.bsky.app/xrpc/app.bsky.actor.searchActors?q=activitypub.ghost.org
 */
export async function searchBlueskyHandle(
    hostname: string,
    maxRetries: number = 3,
): Promise<string | null> {
    const searchUrl = `https://public.api.bsky.app/xrpc/app.bsky.actor.searchActors?q=${encodeURIComponent(hostname)}`;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(searchUrl, {
                headers: {
                    Accept: 'application/json',
                },
            });

            // Retry on temporary failures
            if ([408, 429, 502, 503, 504].includes(response.status)) {
                if (attempt < maxRetries) {
                    const delay = Math.min(1000 * 2 ** (attempt - 1), 4000);

                    console.warn(
                        `Retrying Bluesky API for ${hostname} after ${delay}ms (${response.status})`,
                    );

                    await Bun.sleep(delay);

                    continue;
                }

                // After max retries, return null instead of throwing
                console.warn(
                    `Bluesky API failed for ${hostname} after ${maxRetries} attempts (${response.status})`,
                );

                return null;
            }

            // For non-retryable errors, log and return null
            if (!response.ok) {
                console.warn(
                    `Failed to search Bluesky API for ${hostname} (${response.status})`,
                );

                return null;
            }

            const data: BlueskySearchResponse = await response.json();

            // Look for an actor whose handle ends with .ap.brid.gy and contains the hostname
            for (const actor of data.actors) {
                if (
                    actor.handle.endsWith('.ap.brid.gy') &&
                    actor.handle.includes(hostname)
                ) {
                    return actor.handle;
                }
            }

            return null;
        } catch (error) {
            console.warn(
                `Failed to search Bluesky API for ${hostname}: ${error.message}`,
            );

            return null;
        }
    }

    return null;
}

export async function getAccountsFollowingBridgy(
    connection: mysql.Connection,
    bridgyAccountId: number,
): Promise<{ account_id: number; domain: string }[]> {
    const [rows] = await connection.execute(
        `SELECT a.id as account_id, a.domain as domain
         FROM follows f
         JOIN accounts a ON a.id = f.follower_id
         WHERE f.following_id = ?
         ORDER BY a.id`,
        [bridgyAccountId],
    );

    return rows as { account_id: number; domain: string }[];
}

export async function saveBlueskyHandle(
    connection: mysql.Connection,
    accountId: number,
    handle: string,
) {
    try {
        await connection.execute(
            'INSERT INTO bluesky_integration_account_handles (account_id, handle) VALUES (?, ?)',
            [accountId, handle],
        );
    } catch (error: unknown) {
        const errorMessage =
            error instanceof Error ? error.message : String(error);

        if (
            errorMessage.includes('UNIQUE') ||
            errorMessage.includes('Duplicate')
        ) {
            await connection.execute(
                'UPDATE bluesky_integration_account_handles SET handle = ? WHERE account_id = ?',
                [handle, accountId],
            );
        } else {
            throw error;
        }
    }
}

async function main(bridgyAccountId: number) {
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
        const accounts = await getAccountsFollowingBridgy(
            connection,
            bridgyAccountId,
        );

        console.log(
            `Found ${accounts.length} accounts following bridgy account`,
        );

        for (const account of accounts) {
            const handle = await searchBlueskyHandle(account.domain);

            if (handle) {
                await saveBlueskyHandle(connection, account.account_id, handle);
            } else {
                console.warn(`No Bluesky handle found for ${account.domain}`);
            }

            // Add a small delay to avoid rate limiting
            await Bun.sleep(500);
        }

        console.log('Bluesky handles migration complete');
    } finally {
        await connection.end();
    }

    process.exit(0);
}

if (import.meta.main) {
    const bridgyAccountId = parseInt(
        process.env.BRIDGY_ACCOUNT_ID || process.argv[2] || '',
    );

    if (!bridgyAccountId || Number.isNaN(bridgyAccountId)) {
        console.error('Error: bridgy account ID is required');
        console.error('Usage: bun index.ts <BRIDGY_ACCOUNT_ID>');

        process.exit(1);
    }

    main(bridgyAccountId).catch((error) => {
        console.error('Unhandled error:', error);

        process.exit(1);
    });
}
