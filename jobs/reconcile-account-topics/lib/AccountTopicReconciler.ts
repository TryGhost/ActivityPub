import { randomUUID } from 'bun:crypto';

import {
    type Actor,
    isActor,
    lookupObject,
    lookupWebFinger,
    PropertyValue,
} from '@fedify/fedify';
import type mysql from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2/promise';

interface Topic {
    id: number;
    name: string;
    slug: string;
}

interface Site {
    ghost_uuid: string;
    url: string;
    title: string;
    description: string;
    locale: string;
    ghost_rank: number;
    posts_total: number;
    posts_first: string;
    posts_last: string;
    member_count?: number;
    created_at: string;
    updated_at: string;
    categories: Array<{
        name: string;
        slug: string;
    }>;
    tags: Array<{
        name: string;
    }>;
}

interface ApiResponse {
    data: Site[];
    links: {
        first: string;
        last: string;
        prev: string | null;
        next: string | null;
    };
    meta: {
        current_page: number;
        from: number;
        last_page: number;
        per_page: number;
        to: number;
        total: number;
    };
}

export class AccountTopicReconciler {
    private static readonly MAX_ITEMS_PER_TOPIC = 200;
    private static readonly DEFAULT_USERNAME = 'index';
    private static readonly CATEGORY_OVERRIDE: Record<string, string> = {
        top: '',
    };

    constructor(
        readonly db: mysql.Pool,
        private readonly apiEndpoint: string,
        private readonly apiAuthToken?: string,
    ) {}

    private extractDomain(url: string): string {
        try {
            return new URL(url).hostname;
        } catch {
            throw new Error(`Invalid URL: ${url}`);
        }
    }

    async fetchTopicsFromDatabase(): Promise<Topic[]> {
        const [topicsRows] = await this.db.execute<RowDataPacket[]>(
            'SELECT id, name, slug FROM topics',
        );

        return topicsRows.map((row) => ({
            id: row.id,
            name: row.name,
            slug: row.slug,
        }));
    }

    async fetchSitesForTopic(topicSlug: string): Promise<Site[]> {
        const sites: Site[] = [];

        const categorySlug =
            AccountTopicReconciler.CATEGORY_OVERRIDE[topicSlug] ?? topicSlug;

        let fetchUrl = `${this.apiEndpoint}?ap=1&category=${encodeURIComponent(categorySlug)}&sort=top&locale=en`;

        try {
            while (
                sites.length < AccountTopicReconciler.MAX_ITEMS_PER_TOPIC &&
                fetchUrl
            ) {
                const response = await fetch(fetchUrl, {
                    headers: {
                        Accept: 'application/json',
                        Authorization: `Bearer ${this.apiAuthToken}`,
                    },
                });

                if (!response.ok) {
                    let errorDetails = response.statusText;

                    try {
                        const errorBody = await response.json();

                        if (errorBody.message) {
                            errorDetails = errorBody.message;

                            if (errorBody.errors) {
                                errorDetails += ` - ${JSON.stringify(errorBody.errors)}`;
                            }
                        }
                    } catch {
                        // If we can't parse JSON, just use statusText
                    }

                    console.log(
                        `API request failed for topic "${topicSlug}" (${response.status}): ${errorDetails}`,
                    );

                    break;
                }

                const data: ApiResponse = await response.json();

                if (!data.data || !Array.isArray(data.data)) {
                    console.log(
                        `Invalid API response for topic "${topicSlug}": missing or invalid 'data' field`,
                    );

                    break;
                }

                // Extract sites from API response
                const limit =
                    AccountTopicReconciler.MAX_ITEMS_PER_TOPIC - sites.length;
                const sitesToAdd = data.data.slice(0, limit);

                sites.push(...sitesToAdd);

                // Check if we've reached the limit or if there's no next page
                if (
                    sites.length >=
                        AccountTopicReconciler.MAX_ITEMS_PER_TOPIC ||
                    !data.links.next
                ) {
                    break;
                }

                fetchUrl = data.links.next;
            }

            console.log(
                `Fetched ${sites.length} sites for topic "${topicSlug}"`,
            );

            return sites;
        } catch (error) {
            console.log(
                `Error fetching sites for topic "${topicSlug}":`,
                error,
            );

            return [];
        }
    }

    async fetchActorForDomain(domain: string): Promise<Actor | null> {
        try {
            const handle = `${AccountTopicReconciler.DEFAULT_USERNAME}@${domain}`;

            const webfingerLookupResult = await lookupWebFinger(
                `acct:${handle}`,
            );

            const selfLink = webfingerLookupResult?.links?.find(
                (link) =>
                    link.rel === 'self' &&
                    link.type === 'application/activity+json',
            );

            if (!selfLink?.href) {
                console.log(`No resource found for handle "${handle}"`);

                return null;
            }

            const actor = await lookupObject(selfLink.href);

            if (!isActor(actor)) {
                console.log(`Resource "${selfLink.href}" is not an actor`);

                return null;
            }

            return actor;
        } catch (error) {
            console.log(`Actor lookup failed for domain "${domain}":`, error);

            return null;
        }
    }

    async ensureAccountExistsForDomain(domain: string): Promise<number | null> {
        try {
            const [existingAccounts] = await this.db.execute<RowDataPacket[]>(
                'SELECT id FROM accounts WHERE domain_hash = UNHEX(SHA2(LOWER(?), 256)) LIMIT 1',
                [domain],
            );

            if (existingAccounts.length > 0) {
                return existingAccounts[0].id;
            }

            console.log(`Creating account for domain "${domain}"`);

            const actor = await this.fetchActorForDomain(domain);

            if (!actor) {
                console.log(
                    `Failed to fetch actor for domain "${domain}", skipping`,
                );

                return null;
            }

            const actorId = actor.id?.href;
            const username = actor.preferredUsername?.toString() ?? '';
            const inboxUrl = actor.inboxId?.href;
            const name = actor.name?.toString() || null;
            const bio = actor.summary?.toString() || null;
            const url = actor.url?.toString() ?? null;
            const actorDomain = actor.id
                ? new URL(actor.id.href).hostname
                : domain;
            const uuid = randomUUID();

            // Extract avatar and banner
            const avatarUrl = (await actor.getIcon())?.url?.toString() ?? null;
            const bannerImageUrl =
                (await actor.getImage())?.url?.toString() ?? null;

            // Extract custom fields from attachments
            const customFields: Record<string, string> = {};

            for await (const attachment of actor.getAttachments()) {
                if (!(attachment instanceof PropertyValue)) {
                    continue;
                }

                const fieldName = attachment.name?.toString() || '';
                const fieldValue = attachment.value?.toString() || '';

                if (fieldName && fieldValue) {
                    customFields[fieldName] = fieldValue;
                }
            }

            // Extract public key in the correct format (JSON with id, owner, publicKeyPem)
            let apPublicKey: string | null = null;
            const publicKey = await actor.getPublicKey();

            if (publicKey) {
                const jsonLd = (await publicKey.toJsonLd({
                    format: 'compact',
                })) as {
                    id?: string;
                    owner?: string;
                    publicKeyPem?: string;
                };

                if (typeof jsonLd === 'object' && jsonLd !== null) {
                    apPublicKey = JSON.stringify({
                        id: jsonLd.id ?? '',
                        owner: jsonLd.owner ?? '',
                        publicKeyPem: jsonLd.publicKeyPem ?? '',
                    });
                }
            }

            // Extract AP collection URLs
            const sharedInboxUrl = actor.endpoints?.sharedInbox?.href || null;
            const outboxUrl = actor.outboxId?.href || '';
            const followingUrl = actor.followingId?.href || '';
            const followersUrl = actor.followersId?.href || '';
            const likedUrl = actor.likedId?.href || '';

            if (!actorId || !inboxUrl) {
                console.log(
                    `Actor for domain "${domain}" missing required fields, skipping`,
                );

                return null;
            }

            // Warn if actor domain differs from expected domain
            if (actorDomain !== domain) {
                console.log(
                    `Warning: Actor domain ("${actorDomain}") differs from expected domain ("${domain}") for actor ID "${actorId}"`,
                );
            }

            // Insert account (INSERT IGNORE handles race conditions)
            await this.db.execute(
                `INSERT IGNORE INTO accounts
                (uuid, username, name, bio, avatar_url, banner_image_url, url, custom_fields,
                 ap_id, ap_inbox_url, ap_shared_inbox_url, ap_outbox_url, ap_following_url,
                 ap_followers_url, ap_liked_url, ap_public_key, ap_private_key, domain)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    uuid,
                    username,
                    name,
                    bio,
                    avatarUrl,
                    bannerImageUrl,
                    url,
                    Object.keys(customFields).length > 0
                        ? JSON.stringify(customFields)
                        : null,
                    actorId,
                    inboxUrl,
                    sharedInboxUrl,
                    outboxUrl,
                    followingUrl,
                    followersUrl,
                    likedUrl,
                    apPublicKey || '',
                    null, // ap_private_key - not used for external accounts
                    domain, // Use input domain for consistency with lookups
                ],
            );

            // Query for account ID (handles race conditions)
            const [newAccounts] = await this.db.execute<RowDataPacket[]>(
                'SELECT id FROM accounts WHERE domain_hash = UNHEX(SHA2(LOWER(?), 256)) LIMIT 1',
                [domain],
            );

            if (newAccounts.length > 0) {
                console.log(`Created account for domain "${domain}"`);

                return newAccounts[0].id;
            }

            return null;
        } catch (error) {
            console.log(
                `Error ensuring account for domain "${domain}":`,
                error,
            );

            return null;
        }
    }

    async reconcileMappingsForTopic(
        topicId: number,
        topicName: string,
        accountIds: number[],
    ): Promise<void> {
        // Fetch existing mappings for this topic
        const [existingMappingsRows] = await this.db.execute<RowDataPacket[]>(
            'SELECT account_id FROM account_topics WHERE topic_id = ?',
            [topicId],
        );
        const existingAccountIds = existingMappingsRows.map(
            (row) => row.account_id,
        );

        // Determine what changes need to be made
        const sourceAccountIdsSet = new Set(accountIds);
        const removedMappings = existingAccountIds.filter(
            (id) => !sourceAccountIdsSet.has(id),
        );

        // Perform all writes in a transaction to ensure consistency
        if (accountIds.length > 0 || removedMappings.length > 0) {
            const connection = await this.db.getConnection();

            try {
                await connection.beginTransaction();

                // Remove removed mappings
                if (removedMappings.length > 0) {
                    // Note: Dynamic placeholder generation is safe here as we're only
                    // creating '?' characters, not interpolating user input
                    const placeholders = removedMappings
                        .map(() => '?')
                        .join(',');

                    await connection.execute(
                        `DELETE FROM account_topics WHERE topic_id = ? AND account_id IN (${placeholders})`,
                        [topicId, ...removedMappings],
                    );
                }

                // Insert new mappings and update ranks for existing ones
                // Uses batch INSERT with ON DUPLICATE KEY UPDATE to handle both cases in one query
                if (accountIds.length > 0) {
                    // Build VALUES clause: (accountId, topicId, rank) for each account
                    // Rank is 1-indexed based on position in array (first site = rank 1)
                    const placeholders = accountIds
                        .map(() => '(?, ?, ?)')
                        .join(',');

                    const values: number[] = [];

                    for (let i = 0; i < accountIds.length; i++) {
                        values.push(accountIds[i], topicId, i + 1);
                    }

                    await connection.execute(
                        `INSERT INTO account_topics (account_id, topic_id, rank_in_topic)
                         VALUES ${placeholders} AS new
                         ON DUPLICATE KEY UPDATE rank_in_topic = new.rank_in_topic`,
                        values,
                    );
                }

                await connection.commit();

                // Calculate new mappings for logging
                const existingAccountIdsSet = new Set(existingAccountIds);
                const newMappings = accountIds.filter(
                    (id) => !existingAccountIdsSet.has(id),
                );

                console.log(
                    `Topic "${topicName}": ${newMappings.length} mappings added, ${removedMappings.length} removed`,
                );
            } catch (error) {
                await connection.rollback();

                throw error;
            } finally {
                connection.release();
            }
        }
    }

    async run() {
        // Fetch all topics from database
        const topics = await this.fetchTopicsFromDatabase();

        console.log(`Found ${topics.length} topics in database`);

        if (topics.length === 0) {
            console.log('No topics found in database, exiting');

            return;
        }

        // Process each topic
        for (let i = 0; i < topics.length; i++) {
            const topic = topics[i];

            console.log(
                `Processing topic ${i + 1}/${topics.length}: "${topic.name}" (${topic.slug})`,
            );

            // Fetch sites for this topic
            const sites = await this.fetchSitesForTopic(topic.slug);

            if (sites.length === 0) {
                console.log(`No sites found for topic "${topic.name}"`);
            }

            // Collect account IDs for all sites in this topic
            const accountIds: number[] = [];

            for (let j = 0; j < sites.length; j++) {
                const site = sites[j];

                try {
                    console.log(
                        `Processing site ${j + 1}/${sites.length} for topic "${topic.name}": "${site.url}"`,
                    );

                    // Ensure account exists for this domain
                    const domain = this.extractDomain(site.url);

                    const accountId =
                        await this.ensureAccountExistsForDomain(domain);

                    if (accountId !== null) {
                        accountIds.push(accountId);
                    }
                } catch (error) {
                    console.log(`Error processing site "${site.url}":`, error);
                }
            }

            // Reconcile all mappings for this topic in one batch - This is called
            // even if accountIds is empty to clean up removed mappings
            await this.reconcileMappingsForTopic(
                topic.id,
                topic.name,
                accountIds,
            );
        }
    }
}
