import { Person, PropertyValue } from '@fedify/fedify';
import type { LogRecord } from '@logtape/logtape';
import { configure, getConsoleSink, getLogger } from '@logtape/logtape';
import knex from 'knex';

class RateLimiter {
    private queue: Array<() => void> = [];
    private running = 0;
    private maxConcurrent: number;

    constructor(maxConcurrent: number) {
        this.maxConcurrent = maxConcurrent;
    }

    async acquire(): Promise<() => void> {
        return new Promise((resolve) => {
            if (this.running < this.maxConcurrent) {
                this.running++;
                resolve(() => this.release());
            } else {
                this.queue.push(() => {
                    this.running++;
                    resolve(() => this.release());
                });
            }
        });
    }

    private release(): void {
        this.running--;
        if (this.queue.length > 0) {
            const next = this.queue.shift();
            if (next) next();
        }
    }
}

//Environment configuration
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
    batchSize: Number.parseInt(process.env.BATCH_SIZE || '1000'),
    requestTimeout: Number.parseInt(process.env.REQUEST_TIMEOUT_MS || '30000'),
    concurrentDelay: Number.parseInt(process.env.CONCURRENT_DELAY_MS || '50'),
    batchDelay: Number.parseInt(process.env.BATCH_DELAY_MS || '1000'),
    maxConcurrent: Number.parseInt(process.env.MAX_CONCURRENT || '10'),
    lastUpdatedAt: process.env.LAST_UPDATED_AT || '2025-06-27T00:00:00Z',
};

// Logging
await configure({
    sinks: {
        console: getConsoleSink({
            formatter: (record: LogRecord) => {
                const loggingObject = {
                    severity: record.level.toUpperCase(),
                    timestamp: new Date(record.timestamp).toISOString(),
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
            category: 'update-external-accounts',
            level: 'info',
            sinks: ['console'],
        },
    ],
});

const logger = getLogger('update-external-accounts');

interface Account {
    id?: number;
    username: string;
    ap_id?: URL;
    name?: string | null;
    bio?: string | null;
    avatarUrl?: URL | null;
    bannerImageUrl?: URL | null;
    url?: URL | null;
    custom_fields?: Record<string, string> | null;
}

// Initialize database connection
const db = knex({
    client: 'mysql2',
    connection: config.mysql,
    pool: {
        min: 5,
        max: 20,
        acquireTimeoutMillis: 60000, // Wait up to 1 minute for connection
        createTimeoutMillis: 30000, // 30 seconds to create connection
        destroyTimeoutMillis: 5000, // 5 seconds to close gracefully
        idleTimeoutMillis: 30000, // Close idle connections after 30s
        reapIntervalMillis: 1000, // Check for cleanup every second
        createRetryIntervalMillis: 100, // Retry connection creation quickly
    },
});

async function fetchAccountInfo(apId: string): Promise<Person | null> {
    try {
        const response = await fetch(apId, {
            method: 'GET',
            headers: {
                Accept: 'application/activity+json,application/ld+json',
            },
            signal: AbortSignal.timeout(config.requestTimeout),
        });

        if (!response.ok) {
            logger.warn('Account not accessible: {apId} - HTTP {status}', {
                apId,
                status: response.status,
            });
            return null;
        }

        const accountInfo = await response.json();

        // Person.fromJsonLd to create a proper Person instance
        const person = await Person.fromJsonLd(accountInfo);
        return person;
    } catch (error) {
        const errorMessage =
            error instanceof Error ? error.message : String(error);
        logger.warn('Failed to fetch account info for {apId}: {errorMessage}', {
            apId,
            errorMessage,
        });
        return null;
    }
}

// Fetch external accounts in chunks (accounts not in users table)
async function getExternalAccountsChunk(
    offset: number,
    limit: number,
): Promise<Account[]> {
    const rows = await db('accounts')
        .leftJoin('users', 'users.account_id', 'accounts.id')
        .whereNull('users.account_id')
        .where('accounts.updated_at', '<', config.lastUpdatedAt)
        .select('accounts.id', 'accounts.username', 'accounts.ap_id')
        .orderBy('accounts.id')
        .offset(offset)
        .limit(limit);

    return Promise.all(
        rows.map(async (row) => ({
            id: row.id,
            username: row.username,
            ap_id: new URL(row.ap_id),
        })),
    );
}

// Get total count of external accounts
async function getExternalAccountsCount(): Promise<number> {
    const result = await db('accounts')
        .leftJoin('users', 'users.account_id', 'accounts.id')
        .whereNull('users.account_id')
        .where('accounts.updated_at', '<', config.lastUpdatedAt)
        .count('accounts.id as count')
        .first();

    return Number(result?.count || 0);
}

export async function mapActorToAccount(person: Person): Promise<Account> {
    const customFields: Record<string, string> = {};

    for await (const attachment of person.getAttachments()) {
        if (!(attachment instanceof PropertyValue)) {
            continue;
        }

        const name = attachment.name?.toString() || '';
        const value = attachment.value?.toString() || '';

        if (name && value) {
            customFields[name] = value;
        }
    }

    const icon = await person.getIcon();
    const image = await person.getImage();

    return {
        username: person.preferredUsername?.toString() ?? '',
        name: person.name?.toString() ?? null,
        bio: person.summary?.toString() ?? null,
        avatarUrl: icon?.url ? new URL(icon.url.toString()) : null,
        bannerImageUrl: image?.url ? new URL(image.url.toString()) : null,
        url: person.url ? new URL(person.url.toString()) : null,
        custom_fields:
            Object.keys(customFields).length > 0 ? customFields : null,
    };
}

// Update external accounts in database
async function updateExternalAccount(
    accountId: number,
    updatedAccount: Account,
): Promise<void> {
    try {
        await db('accounts')
            .where('id', accountId)
            .update({
                name: updatedAccount.name,
                bio: updatedAccount.bio,
                username: updatedAccount.username,
                avatar_url: updatedAccount.avatarUrl?.href || null,
                banner_image_url: updatedAccount.bannerImageUrl?.href || null,
                url: updatedAccount.url?.href || null,
                custom_fields: updatedAccount.custom_fields
                    ? JSON.stringify(updatedAccount.custom_fields)
                    : null,
            });

        logger.info(
            'Updated external account {accountId} with fresh information',
            {
                accountId,
                name: updatedAccount.name,
                bio: updatedAccount.bio,
                avatarUrl: updatedAccount.avatarUrl?.toString() || null,
                bannerImageUrl:
                    updatedAccount.bannerImageUrl?.toString() || null,
                url: updatedAccount.url?.toString() || null,
                custom_fields: updatedAccount.custom_fields
                    ? JSON.stringify(updatedAccount.custom_fields)
                    : null,
            },
        );
    } catch (error) {
        const errorMessage =
            error instanceof Error ? error.message : String(error);
        logger.error(
            'Failed to update external account {accountId}: {errorMessage}',
            {
                accountId,
                errorMessage,
            },
        );
        throw error;
    }
}

// Main function
async function main() {
    const startTime = Date.now();
    logger.info('Starting update-external-accounts job', config);

    try {
        // Get total count of external accounts
        logger.info('Counting external accounts...');
        const totalAccounts = await getExternalAccountsCount();

        logger.info('Found {count} total external accounts', {
            count: totalAccounts,
        });

        if (totalAccounts === 0) {
            logger.info('No accounts to process. Exiting.');
            process.exit(0);
        }

        let processed = 0;
        let failed = 0;
        let skipped = 0;
        let offset = 0;
        let chunkNumber = 1;
        const totalChunks = Math.ceil(totalAccounts / config.batchSize);

        // Process accounts in chunks
        while (offset < totalAccounts) {
            logger.info(
                'Fetching chunk {chunkNumber}/{totalChunks} (offset: {offset}, limit: {limit})',
                {
                    chunkNumber,
                    totalChunks,
                    offset,
                    limit: config.batchSize,
                },
            );

            const accounts = await getExternalAccountsChunk(
                offset,
                config.batchSize,
            );

            if (accounts.length === 0) {
                logger.info('No more accounts to process. Exiting.');
                break;
            }

            logger.info(
                'Processing chunk {chunkNumber}/{totalChunks} ({startIndex}-{endIndex})',
                {
                    chunkNumber,
                    totalChunks,
                    startIndex: offset + 1,
                    endIndex: offset + accounts.length,
                },
            );

            // Process accounts in the chunk with controlled concurrency using rate limiting
            const rateLimiter = new RateLimiter(config.maxConcurrent);

            const chunkPromises = accounts.map(async (account, index) => {
                return rateLimiter.acquire().then(async (release) => {
                    try {
                        // Add small delay between requests to be respectful to external servers
                        if (index > 0) {
                            await new Promise((resolve) =>
                                setTimeout(resolve, config.concurrentDelay),
                            );
                        }

                        if (account.ap_id) {
                            const person = await fetchAccountInfo(
                                account.ap_id.href,
                            );
                            if (person) {
                                const updatedAccount =
                                    await mapActorToAccount(person);
                                await updateExternalAccount(
                                    account.id!,
                                    updatedAccount,
                                );
                                processed++;
                            } else {
                                logger.warn('Skipping account: {apId}', {
                                    apId: account.ap_id.href,
                                });
                                skipped++;
                            }
                        } else {
                            logger.warn(
                                'Account {accountId} has no ap_id, skipping',
                                {
                                    accountId: account.id,
                                },
                            );
                            skipped++;
                        }
                    } catch (error) {
                        const errorMessage =
                            error instanceof Error
                                ? error.message
                                : String(error);
                        logger.error(
                            'Failed to process account {accountId} ({apId}): {errorMessage}',
                            {
                                accountId: account.id,
                                apId: account.ap_id?.href || 'unknown',
                                errorMessage,
                            },
                        );
                        failed++;
                    } finally {
                        release();
                    }
                });
            });

            // Wait for all accounts in the chunk to complete
            await Promise.all(chunkPromises);

            // Move to next chunk
            offset += config.batchSize;
            chunkNumber++;

            // Add delay between chunks to reduce database load
            if (offset < totalAccounts) {
                logger.info(
                    'Chunk {chunkNumber} completed. Waiting {delay}ms before next chunk...',
                    {
                        chunkNumber: chunkNumber - 1,
                        delay: config.batchDelay,
                    },
                );
                await new Promise((resolve) =>
                    setTimeout(resolve, config.batchDelay),
                );
            }
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        logger.info(
            '=== JOB COMPLETED === Total: {total} | Processed: {processed} | ' +
                'Failed: {failed} | Skipped: {skipped} | Duration: {duration}s',
            {
                total: totalAccounts,
                processed,
                failed,
                skipped,
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
