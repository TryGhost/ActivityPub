import { randomUUID } from 'node:crypto';

import {
    type Actor,
    isActor,
    lookupObject,
    lookupWebFinger,
    PropertyValue,
} from '@fedify/fedify';
import type mysql from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2/promise';

interface DataSourceItem {
    url: string;
    categories: string[];
}

interface Topic {
    id: number;
    name: string;
    slug: string;
}

export class TopicAccountReconciler {
    private readonly DEFAULT_USERNAME = 'index';

    constructor(readonly db: mysql.Pool) {}

    private extractDomain(url: string): string {
        try {
            return new URL(url).hostname;
        } catch {
            throw new Error(`Invalid URL: ${url}`);
        }
    }

    async fetchData(): Promise<DataSourceItem[]> {
        // TODO:  Use a real data source
        return [
            {
                url: 'https://foo.com/',
                categories: ['Technology', 'Finance'],
            },
            {
                url: 'https://bar.com/',
                categories: ['Technology'],
            },
            {
                url: 'https://baz.com/',
                categories: ['Design'],
            },
            {
                url: 'https://qux.com/',
                categories: ['Technology'],
            },
        ];
    }

    async fetchActorForDomain(domain: string): Promise<Actor | null> {
        try {
            const handle = `${this.DEFAULT_USERNAME}@${domain}`;

            const webfingerLookupResult = await lookupWebFinger(
                `acct:${handle}`,
            );

            const selfLink = webfingerLookupResult?.links?.find(
                (link) =>
                    link.rel === 'self' &&
                    link.type === 'application/activity+json',
            );

            if (!selfLink?.href) {
                console.log(`No resource found for acct:${handle}`);

                return null;
            }

            const actor = await lookupObject(selfLink.href);

            if (!isActor(actor)) {
                console.log(`${selfLink.href} is not an actor`);

                return null;
            }

            return actor;
        } catch (error) {
            console.log(`Actor lookup failed for ${domain}:`, error);

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

            console.log(`Creating account for ${domain}`);

            const actor = await this.fetchActorForDomain(domain);

            if (!actor) {
                console.log(`Failed to fetch actor for ${domain}, skipping`);

                return null;
            }

            const actorId = actor.id?.href;
            const username = actor.preferredUsername || this.DEFAULT_USERNAME;
            const inboxUrl = actor.inboxId?.href;
            const name = actor.name?.toString() || null;
            const bio = actor.summary?.toString() || null;
            const url = actor.url?.href || null;
            const actorDomain = actor.id
                ? new URL(actor.id.href).hostname
                : domain;
            const uuid = randomUUID();

            // Extract avatar and banner
            const avatarUrl = (await actor.getIcon())?.url?.href || null;
            const bannerImageUrl = (await actor.getImage())?.url?.href || null;

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
                    `Actor for ${domain} missing required fields, skipping`,
                );

                return null;
            }

            // Warn if actor domain differs from expected domain
            if (actorDomain !== domain) {
                console.log(
                    `Warning: Actor domain (${actorDomain}) differs from expected domain (${domain}) for ${actorId}`,
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
                    apPublicKey,
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
                console.log(`Created account for ${domain}`);

                return newAccounts[0].id;
            }

            return null;
        } catch (error) {
            console.log(`Error ensuring account for ${domain}:`, error);

            return null;
        }
    }

    private createSlug(name: string): string {
        return name.toLowerCase().trim().replace(/\s+/g, '-');
    }

    private normalizeTopics(
        sourceTopicNames: string[],
    ): Map<string, { canonicalName: string; variants: string[] }> {
        // Group topic names by their slug
        const topicsBySlug = new Map<
            string,
            { canonicalName: string; variants: string[] }
        >();

        for (const name of sourceTopicNames) {
            const slug = this.createSlug(name);

            if (!topicsBySlug.has(slug)) {
                topicsBySlug.set(slug, {
                    canonicalName: name,
                    variants: [name],
                });
            } else {
                const existing = topicsBySlug.get(slug)!;

                existing.variants.push(name);

                // Use alphabetically first name as canonical (for consistency)
                if (name < existing.canonicalName) {
                    existing.canonicalName = name;
                }
            }
        }

        // Log any collisions detected
        for (const [slug, { canonicalName, variants }] of topicsBySlug) {
            if (variants.length > 1) {
                console.log(
                    `Topic slug collision: Multiple names map to '${slug}': [${variants.join(', ')}]. Using '${canonicalName}' as canonical name.`,
                );
            }
        }

        return topicsBySlug;
    }

    async reconcileTopics(dataSourceItems: DataSourceItem[]): Promise<{
        topics: Topic[];
        topicNameToSlug: Map<string, string>;
    }> {
        // Extract all unique topic names from categories
        const sourceTopicNames = [
            ...new Set(dataSourceItems.flatMap((item) => item.categories)),
        ];

        // Normalize topics by slug, detecting collisions
        const normalizedTopics = this.normalizeTopics(sourceTopicNames);

        const [existingTopicsRows] = await this.db.execute<RowDataPacket[]>(
            'SELECT id, name, slug FROM topics',
        );
        const existingTopics = existingTopicsRows.map((row) => ({
            id: row.id,
            name: row.name,
            slug: row.slug,
        }));
        const existingTopicsBySlug = new Map(
            existingTopics.map((t) => [t.slug, t]),
        );

        // Determine what changes need to be made (compare by slug)
        const newTopics: Array<{ name: string; slug: string }> = [];

        for (const [slug, { canonicalName }] of normalizedTopics) {
            if (!existingTopicsBySlug.has(slug)) {
                newTopics.push({ name: canonicalName, slug });
            }
        }

        const sourceSlugs = new Set(normalizedTopics.keys());
        const removedTopics = existingTopics.filter(
            (topic) => !sourceSlugs.has(topic.slug),
        );

        // Perform all writes in a transaction to ensure consistency
        if (newTopics.length > 0 || removedTopics.length > 0) {
            const connection = await this.db.getConnection();

            try {
                await connection.beginTransaction();

                // Insert new topics (no need for INSERT IGNORE since we've deduplicated by slug)
                for (const topic of newTopics) {
                    await connection.execute(
                        'INSERT INTO topics (name, slug) VALUES (?, ?)',
                        [topic.name, topic.slug],
                    );
                }

                // Remove redundant topics
                if (removedTopics.length > 0) {
                    const removedTopicIds = removedTopics.map((t) => t.id);
                    // Note: Dynamic placeholder generation is safe here as we're only
                    // creating '?' characters, not interpolating user input
                    const placeholders = removedTopicIds
                        .map(() => '?')
                        .join(',');

                    await connection.execute(
                        `DELETE FROM topics WHERE id IN (${placeholders})`,
                        removedTopicIds,
                    );
                }

                await connection.commit();
            } catch (error) {
                await connection.rollback();

                throw error;
            } finally {
                connection.release();
            }
        }

        // Fetch all topics
        const [allTopicsRows] = await this.db.execute<RowDataPacket[]>(
            'SELECT id, name, slug FROM topics',
        );
        const allTopics = allTopicsRows.map((row) => ({
            id: row.id,
            name: row.name,
            slug: row.slug,
        }));

        console.log(
            `Topics: ${newTopics.length} added, ${removedTopics.length} removed, ${allTopics.length} total`,
        );

        // Build mapping from all topic name variants to their canonical topic
        // This allows reconcileAccountsForTopic to match all name variations
        const topicNameToSlug = new Map<string, string>();
        for (const [slug, { variants }] of normalizedTopics) {
            for (const variant of variants) {
                topicNameToSlug.set(variant, slug);
            }
        }

        return { topics: allTopics, topicNameToSlug };
    }

    async reconcileMappingsForDomain(
        domain: string,
        topicNames: string[],
        topicsBySlug: Map<string, Topic>,
        topicNameToSlug: Map<string, string>,
    ): Promise<void> {
        // Ensure account exists for domain
        const accountId = await this.ensureAccountExistsForDomain(domain);

        if (accountId === null) {
            console.log(
                `Failed to create account for ${domain}, skipping mappings`,
            );

            return;
        }

        // Get topic IDs for all categories (using slug mapping to handle variants)
        const topicIds = topicNames
            .map((name) => {
                const slug = topicNameToSlug.get(name);

                return slug ? topicsBySlug.get(slug)?.id : undefined;
            })
            .filter((id): id is number => id !== undefined);

        if (topicIds.length === 0) {
            console.log(`No valid topics found for ${domain}`);

            return;
        }

        // Fetch existing mappings for this account
        const [existingMappingsRows] = await this.db.execute<RowDataPacket[]>(
            'SELECT topic_id FROM account_topics WHERE account_id = ?',
            [accountId],
        );
        const existingTopicIds = existingMappingsRows.map(
            (row) => row.topic_id,
        );

        // Determine what changes need to be made
        const existingTopicIdsSet = new Set(existingTopicIds);
        const newMappings = topicIds.filter(
            (id) => !existingTopicIdsSet.has(id),
        );

        const sourceTopicIdsSet = new Set(topicIds);
        const removedMappings = existingTopicIds.filter(
            (id) => !sourceTopicIdsSet.has(id),
        );

        // Perform all writes in a transaction to ensure consistency
        if (newMappings.length > 0 || removedMappings.length > 0) {
            const connection = await this.db.getConnection();

            try {
                await connection.beginTransaction();

                // Insert new mappings
                for (const topicId of newMappings) {
                    await connection.execute(
                        'INSERT IGNORE INTO account_topics (account_id, topic_id) VALUES (?, ?)',
                        [accountId, topicId],
                    );
                }

                // Remove removed mappings
                if (removedMappings.length > 0) {
                    // Note: Dynamic placeholder generation is safe here as we're only
                    // creating '?' characters, not interpolating user input
                    const placeholders = removedMappings
                        .map(() => '?')
                        .join(',');

                    await connection.execute(
                        `DELETE FROM account_topics WHERE account_id = ? AND topic_id IN (${placeholders})`,
                        [accountId, ...removedMappings],
                    );
                }

                await connection.commit();

                console.log(
                    `Domain '${domain}': ${newMappings.length} mappings added, ${removedMappings.length} removed`,
                );
            } catch (error) {
                await connection.rollback();

                throw error;
            } finally {
                connection.release();
            }
        }
    }

    async reconcileAccountsForTopics() {
        console.log('Starting topic-account reconciliation');

        // Fetch data from source
        const dataSourceItems = await this.fetchData();

        console.log(`Fetched ${dataSourceItems.length} items from data source`);

        // Reconcile topics (returns topics and mapping from all name variants to slugs)
        const { topics, topicNameToSlug } =
            await this.reconcileTopics(dataSourceItems);

        // Build lookup map for topics by slug
        const topicsBySlug = new Map(topics.map((t) => [t.slug, t]));

        // Process each domain
        for (let i = 0; i < dataSourceItems.length; i++) {
            const item = dataSourceItems[i];
            const domain = this.extractDomain(item.url);

            console.log(
                `Processing domain ${i + 1}/${dataSourceItems.length}: ${domain}`,
            );

            await this.reconcileMappingsForDomain(
                domain,
                item.categories,
                topicsBySlug,
                topicNameToSlug,
            );
        }

        console.log(
            `Reconciliation complete: ${dataSourceItems.length} domains processed, ${topics.length} topics active`,
        );
    }
}
