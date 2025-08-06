import { promisify } from 'node:util';
import { gzip } from 'node:zlib';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
    type Actor,
    type Collection,
    isActor,
    lookupObject,
    lookupWebFinger,
} from '@fedify/fedify';

const gzipAsync = promisify(gzip);

// Simple environment configuration
const config = {
    curatorHandle:
        process.env.CURATOR_ACCOUNT_HANDLE || '@index@pubactivity.ghost.io',
    s3Endpoint: process.env.S3_ENDPOINT || 'https://storage.googleapis.com',
    s3Region: process.env.S3_REGION || 'auto',
    s3Bucket: process.env.S3_BUCKET_NAME || 'explore-data',
    s3FilePath: process.env.S3_FILE_PATH || 'explore/accounts.json',
    s3AccessKeyId: process.env.S3_ACCESS_KEY_ID,
    s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    maxConcurrent: Number.parseInt(process.env.MAX_CONCURRENT_REQUESTS || '10'),
    requestTimeout: Number.parseInt(process.env.REQUEST_TIMEOUT_MS || '30000'), // 30 seconds default
};

// AccountDTO interface
interface AccountDTO {
    id: string;
    apId: string;
    name: string;
    handle: string;
    avatarUrl: string | null;
    bio: string | null;
    url: string | null;
    bannerImageUrl: string | null;
    customFields: Record<string, string>;
    postCount: number;
    likedCount: number;
    followingCount: number;
    followerCount: number;
}

// Parse handle like @user@domain
function parseHandle(handle: string): { username: string; domain: string } {
    const parts = handle.split('@');
    if (parts.length !== 3) throw new Error(`Invalid handle format: ${handle}`);
    return { username: parts[1], domain: parts[2] };
}

// Fetch with timeout
async function fetchWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    errorMessage: string,
): Promise<T> {
    const timeout = new Promise<never>((_, reject) => {
        setTimeout(
            () => reject(new Error(`Timeout: ${errorMessage}`)),
            timeoutMs,
        );
    });

    return Promise.race([promise, timeout]);
}

// Fetch actor using WebFinger
async function fetchActor(
    username: string,
    domain: string,
): Promise<Actor | null> {
    try {
        const resource = `acct:${username}@${domain}`;
        const webfingerData = await fetchWithTimeout(
            lookupWebFinger(resource),
            config.requestTimeout,
            `WebFinger lookup for ${resource}`,
        );

        const selfLink = webfingerData?.links?.find(
            (link) =>
                link.rel === 'self' &&
                link.type === 'application/activity+json',
        );

        if (!selfLink?.href) return null;

        const actor = await fetchWithTimeout(
            lookupObject(selfLink.href),
            config.requestTimeout,
            `Actor lookup for ${selfLink.href}`,
        );

        return actor && isActor(actor) ? actor : null;
    } catch (error) {
        console.error(`Failed to fetch actor ${username}@${domain}:`, error);
        return null;
    }
}

// Fetch actor directly from URL
async function fetchActorFromUrl(url: string): Promise<Actor | null> {
    try {
        const object = await fetchWithTimeout(
            lookupObject(url),
            config.requestTimeout,
            `Actor lookup for ${url}`,
        );

        if (!object) {
            console.error(`Object not found: ${url}`);
            return null;
        }

        if (!isActor(object)) {
            console.error(`Object is not an actor: ${url}`, object);
            return null;
        }

        return object;
    } catch (error) {
        console.error(`Failed to fetch actor from ${url}:`, error);
        return null;
    }
}

// Get collection count
async function getCollectionCount(
    actor: Actor,
    collection: 'outbox' | 'liked' | 'followers' | 'following',
): Promise<number> {
    try {
        const getCollection =
            actor[
                `get${collection.charAt(0).toUpperCase() + collection.slice(1)}`
            ];
        const result = await fetchWithTimeout(
            getCollection.bind(actor)(),
            5000, // 5 second timeout for collection counts
            `${collection} collection`,
        );
        return (result as Collection)?.totalItems ?? 0;
    } catch {
        return 0;
    }
}

function getHandle(actor: Actor): string {
    const hostname = new URL(actor.id?.href || '').hostname;
    return `@${actor.preferredUsername}@${hostname.replace(/^www./, '')}`;
}

// Convert Actor to AccountDTO
async function actorToAccountDTO(actor: Actor): Promise<AccountDTO> {
    const actorId = actor.id?.href || '';
    const handle = getHandle(actor);

    const [icon, image] = await Promise.all([
        actor.getIcon(),
        actor.getImage(),
    ]);

    const [postCount, likedCount, followingCount, followerCount] =
        await Promise.all([
            getCollectionCount(actor, 'outbox'),
            getCollectionCount(actor, 'liked'),
            getCollectionCount(actor, 'following'),
            getCollectionCount(actor, 'followers'),
        ]);

    // Extract custom fields
    const customFields: Record<string, string> = {};
    try {
        const attachments = await actor.getAttachments();
        for await (const attachment of attachments) {
            if (attachment && 'name' in attachment && 'value' in attachment) {
                const name = String(attachment.name || '');
                const value = String(attachment.value || '');
                if (name && value) customFields[name] = value;
            }
        }
    } catch {}

    return {
        id: actorId,
        apId: actorId,
        name:
            actor.name?.toString() || actor.preferredUsername?.toString() || '',
        handle,
        avatarUrl: icon?.url
            ? typeof icon.url === 'string'
                ? icon.url
                : icon.url instanceof URL
                  ? icon.url.href
                  : icon.url.toString()
            : null,
        bio: actor.summary?.toString() || null,
        url: actor.url
            ? typeof actor.url === 'string'
                ? actor.url
                : actor.url instanceof URL
                  ? actor.url.href
                  : actor.url.toString()
            : actorId,
        bannerImageUrl: image?.url
            ? typeof image.url === 'string'
                ? image.url
                : image.url instanceof URL
                  ? image.url.href
                  : null
            : null,
        customFields,
        postCount,
        likedCount,
        followingCount,
        followerCount,
    };
}

// Fetch following list
async function fetchFollowing(
    username: string,
    domain: string,
): Promise<string[]> {
    const actor = await fetchActor(username, domain);
    if (!actor)
        throw new Error(`Could not fetch actor for ${username}@${domain}`);

    const followingCollection = await actor.getFollowing();
    if (!followingCollection) return [];

    const items: string[] = [];

    // Handle paginated collection
    if (
        'getFirst' in followingCollection &&
        typeof followingCollection.getFirst === 'function'
    ) {
        let currentPage = await followingCollection.getFirst();

        while (currentPage) {
            // Use itemIds directly
            for (const itemId of currentPage.itemIds) {
                items.push(itemId.href);
            }

            // Get next page if available
            if (
                'getNext' in currentPage &&
                typeof currentPage.getNext === 'function'
            ) {
                currentPage = await currentPage.getNext();
            } else {
                break;
            }
        }
    }

    return items;
}

// Process actors with constant concurrency
async function processActors(
    urls: string[],
    maxConcurrent: number,
): Promise<AccountDTO[]> {
    const accounts: AccountDTO[] = [];
    let completed = 0;
    let started = 0;
    let failed = 0;
    let timedOut = 0;

    // Create a queue of work
    const queue = [...urls];

    // Worker function that processes URLs from the queue
    async function worker(workerId: number) {
        while (queue.length > 0) {
            const url = queue.shift();
            if (!url) {
                // No more work, wait a bit for others to finish
                break;
            }

            started++;
            const startTime = Date.now();
            console.log(
                `[Worker ${workerId}] Starting ${url} (${started}/${urls.length})`,
            );

            try {
                const actor = await fetchActorFromUrl(url);
                if (actor) {
                    const account = await actorToAccountDTO(actor);
                    accounts.push(account);
                    console.log(
                        `[Worker ${workerId}] ✓ Completed ${url} in ${Date.now() - startTime}ms`,
                    );
                } else {
                    failed++;
                    console.log(
                        `[Worker ${workerId}] ✗ Failed ${url} (no actor) in ${Date.now() - startTime}ms`,
                    );
                }
            } catch (error) {
                if (error.message?.startsWith('Timeout:')) {
                    timedOut++;
                    console.log(
                        `[Worker ${workerId}] ⏱ Timeout ${url} after ${Date.now() - startTime}ms`,
                    );
                } else {
                    failed++;
                    console.log(
                        `[Worker ${workerId}] ✗ Failed ${url} (error) in ${Date.now() - startTime}ms`,
                    );
                }
            }

            completed++;

            if (completed % 10 === 0 || completed === urls.length) {
                console.log(
                    `\n=== Progress: ${completed}/${urls.length} completed (${accounts.length} successful, ${failed} failed, ${timedOut} timed out) ===\n`,
                );
            }
        }

        console.log(`[Worker ${workerId}] Finished`);
    }

    // Start workers up to maxConcurrent
    console.log(
        `Starting ${Math.min(maxConcurrent, urls.length)} workers for ${urls.length} URLs`,
    );
    console.log(`Request timeout: ${config.requestTimeout}ms`);
    const workers = Array(Math.min(maxConcurrent, urls.length))
        .fill(null)
        .map((_, i) => worker(i + 1));

    // Wait for all workers to complete
    await Promise.all(workers);

    console.log(
        `\nAll workers completed. Total: ${accounts.length} accounts fetched successfully, ${failed} failed, ${timedOut} timed out`,
    );

    return accounts;
}

// Upload to S3-compatible storage
async function uploadToS3(data: object) {
    const json = JSON.stringify(data, null, 2);
    const compressed = await gzipAsync(json);

    console.log(
        `Uploading ${compressed.length} bytes (compressed from ${json.length} bytes)`,
    );

    const s3Client = new S3Client({
        endpoint: config.s3Endpoint,
        region: config.s3Region,
        forcePathStyle: true, // Required for MinIO and non-AWS S3
        credentials:
            config.s3AccessKeyId && config.s3SecretAccessKey
                ? {
                      accessKeyId: config.s3AccessKeyId,
                      secretAccessKey: config.s3SecretAccessKey,
                  }
                : undefined,
    });

    await s3Client.send(
        new PutObjectCommand({
            Bucket: config.s3Bucket,
            Key: config.s3FilePath,
            Body: compressed,
            ContentType: 'application/json',
            ContentEncoding: 'gzip',
        }),
    );

    console.log(`Uploaded to s3://${config.s3Bucket}/${config.s3FilePath}`);
}

// Main function
async function main() {
    const startTime = Date.now();
    console.log('Starting populate-explore-json job');
    console.log(`Curator account: ${config.curatorHandle}`);

    try {
        // Parse curator handle
        const { username, domain } = parseHandle(config.curatorHandle);

        // Fetch following list
        console.log('Fetching following list...');
        const followingUrls = await fetchFollowing(username, domain);
        console.log(`Found ${followingUrls.length} accounts`);

        if (followingUrls.length === 0) {
            await uploadToS3({
                generated_at: new Date().toISOString(),
                curator_account: config.curatorHandle,
                accounts: [],
            });
            return;
        }

        // Process all accounts
        const accounts = await processActors(
            followingUrls,
            config.maxConcurrent,
        );
        console.log(`Successfully fetched ${accounts.length} accounts`);

        // Sort by follower count
        accounts.sort((a, b) => b.followerCount - a.followerCount);

        // Upload to storage
        await uploadToS3({
            generated_at: new Date().toISOString(),
            curator_account: config.curatorHandle,
            accounts,
        });

        console.log(
            `Job completed in ${((Date.now() - startTime) / 1000).toFixed(1)}s`,
        );
        process.exit(0);
    } catch (error) {
        console.error('Job failed:', error);
        process.exit(1);
    }
}

// Run
main().catch(console.error);
