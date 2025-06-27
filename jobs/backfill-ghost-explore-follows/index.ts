import { createHash, randomUUID } from 'node:crypto';
import type { LogRecord, Logger } from '@logtape/logtape';
import { configure, getConsoleSink, getLogger } from '@logtape/logtape';
import knex from 'knex';

// Simple environment configuration
const config = {
    mysql: process.env.MYSQL_SOCKET_PATH
        ? {
              socketPath: process.env.MYSQL_SOCKET_PATH,
              user: process.env.MYSQL_USER,
              password: process.env.MYSQL_PASSWORD,
              database: process.env.MYSQL_DATABASE,
              timezone: '+00:00',
          }
        : {
              host: process.env.MYSQL_HOST,
              port: Number.parseInt(process.env.MYSQL_PORT!),
              user: process.env.MYSQL_USER,
              password: process.env.MYSQL_PASSWORD,
              database: process.env.MYSQL_DATABASE,
              timezone: '+00:00',
          },
    batchSize: Number.parseInt(process.env.BATCH_SIZE || '10'),
    ghostExploreApId:
        process.env.GHOST_EXPLORE_AP_ID ||
        'https://mastodon.social/users/ghostexplore',
    requestTimeout: Number.parseInt(process.env.REQUEST_TIMEOUT_MS || '30000'),
    concurrentDelay: Number.parseInt(process.env.CONCURRENT_DELAY_MS || '100'),
    batchDelay: Number.parseInt(process.env.BATCH_DELAY_MS || '1000'),
};

// Configure logging
await configure({
    sinks: {
        console: getConsoleSink({
            formatter: (record: LogRecord) => {
                const loggingObject = {
                    timestamp: new Date(record.timestamp).toISOString(),
                    severity: record.level.toUpperCase(),
                    message: record.message.join(''),
                    ...record.properties,
                };
                return JSON.stringify(loggingObject);
            },
        }),
    },
    filters: {},
    loggers: [
        {
            category: 'backfill-ghost-explore-follows',
            level: 'info',
            sinks: ['console'],
        },
    ],
});

// Logger instance
const logger = getLogger('backfill-ghost-explore-follows');

interface Account {
    id: number;
    username: string;
    ap_id: URL;
    ap_inbox_url: URL;
    ap_private_key: CryptoKey;
}

interface GhostExploreAccount {
    id: number;
    ap_id: URL;
    ap_inbox_url: URL;
}

// Initialize database connection
const db = knex({
    client: 'mysql2',
    connection: config.mysql,
    pool: {
        min: 2,
        max: 10,
    },
});

async function importKey(key: string): Promise<CryptoKey> {
    const jwk = JSON.parse(key);
    return await crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['sign'],
    );
}

// Fetch internal accounts not following Ghost Explore
async function getInternalAccountsNotFollowing(
    ghostExploreId: number,
): Promise<Account[]> {
    const row = await db('accounts')
        .innerJoin('users', 'users.account_id', 'accounts.id')
        .leftJoin('follows', function () {
            this.on('follows.follower_id', '=', 'accounts.id').andOn(
                'follows.following_id',
                '=',
                db.raw('?', [ghostExploreId]),
            );
        })
        .whereNull('follows.id')
        .select(
            'accounts.id',
            'accounts.username',
            'accounts.ap_id',
            'accounts.ap_inbox_url',
            'accounts.ap_private_key',
        );

    return Promise.all(
        row.map(async (row) => ({
            id: row.id,
            username: row.username,
            ap_id: new URL(row.ap_id),
            ap_inbox_url: new URL(row.ap_inbox_url),
            ap_private_key: await importKey(row.ap_private_key),
        })),
    );
}

// Get Ghost Explore account from database
async function getGhostExploreAccount(): Promise<GhostExploreAccount | null> {
    const result = await db('accounts')
        .where('ap_id', config.ghostExploreApId)
        .select('id', 'ap_id', 'ap_inbox_url')
        .first();

    return result
        ? {
              id: result.id,
              ap_id: new URL(result.ap_id),
              ap_inbox_url: new URL(result.ap_inbox_url),
          }
        : null;
}

// Check if an account is accessible before sending follow request
async function checkAccountAccessible(
    account: Account,
    logger: Logger,
): Promise<boolean> {
    try {
        const response = await fetch(account.ap_id.href, {
            method: 'GET',
            headers: {
                Accept: 'application/activity+json,application/ld+json',
            },
            signal: AbortSignal.timeout(10000), // 10 second timeout for pre-check
            redirect: 'manual', // Don't follow redirects automatically
        });

        // Check for redirects (which Mastodon doesn't handle well)
        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get('location');
            logger.warn(
                'Account check failed: Redirect detected for {apId} to {location}',
                {
                    apId: account.ap_id.href,
                    location: location || 'unknown',
                    status: response.status,
                },
            );
            return false;
        }

        // Check for non-success status codes
        if (!response.ok) {
            logger.warn(
                'Account check failed: HTTP {status} {statusText} for {apId}',
                {
                    apId: account.ap_id.href,
                    status: response.status,
                    statusText: response.statusText,
                },
            );
            return false;
        }

        // Verify content type is ActivityPub
        const contentType = response.headers.get('content-type');
        if (
            !contentType ||
            (!contentType.includes('application/activity+json') &&
                !contentType.includes('application/ld+json') &&
                !contentType.includes('application/json'))
        ) {
            logger.warn(
                'Account check failed: Invalid content-type {contentType} for {apId}',
                {
                    apId: account.ap_id.href,
                    contentType: contentType || 'none',
                },
            );
            return false;
        }

        // Try to parse the response to ensure it's valid JSON
        try {
            const body = await response.text();
            const data = JSON.parse(body);

            // Basic ActivityPub validation - check for required fields
            if (!data.id || !data.type || !data.inbox) {
                logger.warn(
                    'Account check failed: Invalid ActivityPub object for {apId} (missing required fields)',
                    {
                        apId: account.ap_id.href,
                        hasId: !!data.id,
                        hasType: !!data.type,
                        hasInbox: !!data.inbox,
                    },
                );
                return false;
            }

            // Check if the returned ID matches what we expected (no redirect shenanigans)
            if (data.id !== account.ap_id.href) {
                logger.warn(
                    'Account check failed: ID mismatch for {apId} (got {returnedId})',
                    {
                        apId: account.ap_id.href,
                        returnedId: data.id,
                    },
                );
                return false;
            }
        } catch (parseError) {
            logger.warn(
                'Account check failed: Invalid JSON response for {apId}',
                {
                    apId: account.ap_id.href,
                    parseError:
                        parseError instanceof Error
                            ? parseError.message
                            : String(parseError),
                },
            );
            return false;
        }

        return true;
    } catch (error) {
        const errorMessage =
            error instanceof Error ? error.message : String(error);
        const isSSLError =
            errorMessage.toLowerCase().includes('ssl') ||
            errorMessage.toLowerCase().includes('certificate') ||
            errorMessage.toLowerCase().includes('tls');

        logger.warn('Account check failed for {apId}: {errorMessage}', {
            apId: account.ap_id.href,
            errorMessage,
            isSSLError,
        });

        return false;
    }
}

type FollowActivity = {
    id: string;
    type: string;
    actor: string;
    object: string;
    '@context': string[];
};

// Create a follow activity - to be persisted in database
async function createFollowActivity(
    account: Account,
    ghostExplore: GhostExploreAccount,
): Promise<FollowActivity> {
    const followId = randomUUID();

    const apId = new URL(
        `/.ghost/activitypub/follow/${followId}`,
        account.ap_id,
    );

    return {
        id: apId.href,
        type: 'Follow',
        actor: account.ap_id.href,
        object: ghostExplore.ap_id.href,
        '@context': [
            'https://www.w3.org/ns/activitystreams',
            'https://w3id.org/security/data-integrity/v1',
        ],
    };
}

// Send follow activity for a single account
async function sendFollowActivity(
    account: Account,
    ghostExplore: GhostExploreAccount,
    logger: Logger,
) {
    try {
        const follow = await createFollowActivity(account, ghostExplore);

        // Store the follow activity in the database
        await db('key_value').insert({
            key: JSON.stringify([follow.id]),
            value: JSON.stringify(follow),
        });

        // Send the activity to the remote inbox
        await sendFollowActivityToInbox(follow, account, ghostExplore, logger);
    } catch (error) {
        const errorMessage =
            error instanceof Error ? error.message : String(error);
        logger.error('Failed to create follow for {apId}: {errorMessage}', {
            apId: account.ap_id.href,
            errorMessage,
        });
        throw error;
    }
}

/**
 * Send a Follow activity to a remote inbox with HTTP signature
 * Following the ActivityPub and HTTP Signature specifications
 */
async function sendFollowActivityToInbox(
    activity: FollowActivity,
    followerAccount: Account,
    targetAccount: GhostExploreAccount,
    logger: Logger,
): Promise<void> {
    try {
        // Prepare the request body
        const body = JSON.stringify(activity);

        // Create headers
        const headers: Record<string, string> = {
            Host: targetAccount.ap_inbox_url.host,
            Date: new Date().toUTCString(),
            'Content-Type': 'application/activity+json',
            Accept: 'application/activity+json',
        };

        // Add Digest header (SHA-256 of the body)
        const bodyBuffer = Buffer.from(body);
        const digest = createHash('sha256').update(bodyBuffer).digest('base64');
        headers.Digest = `SHA-256=${digest}`;

        // Prepare the signature
        const keyId = `${followerAccount.ap_id}#main-key`;

        // Create the signing string (headers to sign)
        const headersToSign = ['(request-target)', 'host', 'date', 'digest'];
        const signingString = headersToSign
            .map((header) => {
                if (header === '(request-target)') {
                    return `(request-target): post ${targetAccount.ap_inbox_url.pathname}`;
                }
                return `${header}: ${headers[header.charAt(0).toUpperCase() + header.slice(1)]}`;
            })
            .join('\n');

        // Sign with Web Crypto API
        const encoder = new TextEncoder();
        const signingData = encoder.encode(signingString);

        // Create signature using Web Crypto API
        const signatureArrayBuffer = await crypto.subtle.sign(
            'RSASSA-PKCS1-v1_5',
            followerAccount.ap_private_key,
            signingData,
        );

        // Convert ArrayBuffer to base64
        const signature = Buffer.from(signatureArrayBuffer).toString('base64');

        // Add Signature header
        headers.Signature = `keyId="${keyId}",algorithm="rsa-sha256",headers="${headersToSign.join(' ')}",signature="${signature}"`;

        // Send the request
        const response = await fetch(targetAccount.ap_inbox_url.href, {
            method: 'POST',
            headers,
            body,
            signal: AbortSignal.timeout(config.requestTimeout),
        });

        if (!response.ok) {
            const responseText = await response.text();
            throw new Error(`HTTP ${response.status}: ${responseText}`);
        }

        logger.info(
            'Successfully sent Follow activity from {follower} to {targetInbox}',
            {
                follower: followerAccount.ap_id.href,
                targetInbox: targetAccount.ap_inbox_url.href,
            },
        );
    } catch (error) {
        const errorMessage =
            error instanceof Error ? error.message : String(error);
        logger.error(
            'Failed to send Follow activity from {follower}: {errorMessage}',
            {
                errorMessage,
                follower: followerAccount.ap_id.href,
                targetInbox: targetAccount.ap_inbox_url.href,
            },
        );
        throw error;
    }
}

async function processAccountsInBatches(
    accounts: Account[],
    ghostExplore: GhostExploreAccount,
    logger: Logger,
) {
    let processed = 0;
    let failed = 0;
    let skipped = 0;
    let sslErrors = 0;
    const startTime = Date.now();

    for (let i = 0; i < accounts.length; i += config.batchSize) {
        const batch = accounts.slice(i, i + config.batchSize);
        const batchNumber = Math.floor(i / config.batchSize) + 1;
        const totalBatches = Math.ceil(accounts.length / config.batchSize);

        logger.info(
            'Processing batch {batchNumber}/{totalBatches} ({batchSize} accounts)',
            {
                batchNumber,
                totalBatches,
                batchSize: batch.length,
            },
        );

        // Process batch with concurrency control
        const promises = batch.map((account, index) =>
            (async () => {
                // Add slight delay between concurrent requests
                await new Promise((r) =>
                    setTimeout(r, index * config.concurrentDelay),
                );

                try {
                    // Pre-check if account is accessible
                    const isAccessible = await checkAccountAccessible(
                        account,
                        logger,
                    );
                    if (!isAccessible) {
                        skipped++;
                        logger.info('Skipping inaccessible account: {apId}', {
                            apId: account.ap_id.href,
                        });
                        return;
                    }

                    await sendFollowActivity(account, ghostExplore, logger);
                    processed++;
                } catch (error) {
                    failed++;
                    const errorMessage =
                        error instanceof Error ? error.message : String(error);
                    const isSSLError =
                        errorMessage.toLowerCase().includes('ssl') ||
                        errorMessage.toLowerCase().includes('certificate') ||
                        errorMessage.toLowerCase().includes('tls');

                    if (isSSLError) {
                        sslErrors++;
                    }

                    logger.error(
                        'Failed to process account {apId}: {errorMessage}',
                        {
                            apId: account.ap_id.href,
                            errorMessage,
                            isSSLError,
                        },
                    );
                }
            })(),
        );

        // Wait for batch to complete
        await Promise.all(promises);

        // Log progress checkpoint every 5 batches or at the end
        if (batchNumber % 5 === 0 || i + config.batchSize >= accounts.length) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            logger.info(
                '=== CHECKPOINT === Batch {batchNumber}/{totalBatches} | ' +
                    'Processed: {processed} | Failed: {failed} | Skipped: {skipped} | ' +
                    'SSL Errors: {sslErrors} | Elapsed: {elapsed}s',
                {
                    batchNumber,
                    totalBatches,
                    processed,
                    failed,
                    skipped,
                    sslErrors,
                    elapsed,
                },
            );
        }

        // Add delay between batches to avoid overwhelming the server
        if (i + config.batchSize < accounts.length) {
            await new Promise((resolve) =>
                setTimeout(resolve, config.batchDelay),
            );
        }
    }

    return { processed, failed, skipped, sslErrors };
}

// Main function
async function main() {
    const startTime = Date.now();
    logger.info('Starting backfill-ghost-explore-follows job', config);

    try {
        // Get Ghost Explore account
        logger.info('Fetching Ghost Explore account...');
        const ghostExplore = await getGhostExploreAccount();

        if (!ghostExplore) {
            throw new Error(
                `Ghost Explore account not found: ${config.ghostExploreApId}`,
            );
        }

        logger.info('Found Ghost Explore account: {apId} (ID: {id})', {
            apId: ghostExplore.ap_id.href,
            id: ghostExplore.id,
        });

        // Get internal accounts not following Ghost Explore
        logger.info(
            'Fetching internal accounts not following Ghost Explore...',
        );
        const accounts = await getInternalAccountsNotFollowing(ghostExplore.id);

        logger.info(
            'Found {count} internal accounts not following Ghost Explore',
            {
                count: accounts.length,
            },
        );

        if (accounts.length === 0) {
            logger.info('No accounts to process. Exiting.');
            process.exit(0);
        }

        // Process accounts
        const { processed, failed, skipped, sslErrors } =
            await processAccountsInBatches(accounts, ghostExplore, logger);

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        logger.info(
            '=== JOB COMPLETED === Total: {total} | Processed: {processed} | ' +
                'Failed: {failed} | Skipped: {skipped} | SSL errors: {sslErrors} | Duration: {duration}s',
            {
                total: accounts.length,
                processed,
                failed,
                skipped,
                sslErrors,
                duration,
            },
        );

        process.exit(failed > 0 ? 1 : 0);
    } catch (error) {
        const errorMessage =
            error instanceof Error ? error.message : String(error);
        logger.error('Job failed: {errorMessage}', { errorMessage });
        process.exit(1);
    } finally {
        await db.destroy();
    }
}

// Run
main().catch(console.error);
