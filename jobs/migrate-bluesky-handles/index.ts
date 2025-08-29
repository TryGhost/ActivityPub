#!/usr/bin/env bun

import { SQL } from 'bun';

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
): Promise<string | null> {
    const searchUrl = `https://public.api.bsky.app/xrpc/app.bsky.actor.searchActors?q=${encodeURIComponent(hostname)}`;

    const response = await fetch(searchUrl, {
        headers: {
            Accept: 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error(
            `Bluesky API returned status ${response.status} for ${hostname}`,
        );
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
}

export async function getAccountsFollowingBridgy(
    sql: SQL,
    bridgyAccountId: number,
): Promise<{ account_id: number; domain: string }[]> {
    const accounts = await sql`
        SELECT a.id as account_id, a.domain as domain
        FROM follows f
        JOIN accounts a ON a.id = f.follower_id
        WHERE f.following_id = ${bridgyAccountId}
        ORDER BY a.id
    `;

    return accounts;
}

export async function saveBlueskyHandle(
    sql: SQL,
    accountId: number,
    handle: string,
) {
    try {
        await sql`
            INSERT INTO bluesky_integration_account_handles (account_id, handle)
            VALUES (${accountId}, ${handle})
        `;
    } catch (error: unknown) {
        const errorMessage =
            error instanceof Error ? error.message : String(error);

        if (
            errorMessage.includes('UNIQUE') ||
            errorMessage.includes('Duplicate')
        ) {
            await sql`
                UPDATE bluesky_integration_account_handles
                SET handle = ${handle}
                WHERE account_id = ${accountId}
            `;
        } else {
            throw error;
        }
    }
}

async function main(bridgyAccountId: number) {
    console.log('Starting Bluesky handles migration...');

    const sql = new SQL({
        adapter: 'mysql',
        host: process.env.DB_HOST,
        port: parseInt(process.env.DB_PORT || '3306'),
        username: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
    });

    const accounts = await getAccountsFollowingBridgy(sql, bridgyAccountId);

    console.log(`Found ${accounts.length} accounts following bridgy account`);

    for (const account of accounts) {
        const handle = await searchBlueskyHandle(account.domain);

        if (handle) {
            await saveBlueskyHandle(sql, account.account_id, handle);
        } else {
            console.warn(`No Bluesky handle found for ${account.domain}`);
        }

        // Add a small delay to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 500));
    }

    console.log('Bluesky handles migration complete');

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
