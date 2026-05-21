import type { KvKey, KvStore } from '@fedify/fedify';
import { Temporal } from '@js-temporal/polyfill';
import type { Logger } from '@logtape/logtape';
import type { Knex } from 'knex';

import type { Account } from '@/account/account.entity';
import { OutboxType } from '@/post/post.entity';
import type { Site } from '@/site/site.service';

interface NodeInfoCounts {
    localPosts: number;
    localComments: number;
}

interface CachedNodeInfo {
    software: {
        name: 'ghost';
        version: { major: number; minor: number; patch: number };
        homepage: string;
        repository: string;
    };
    protocols: ['activitypub'];
    services: {
        inbound: [];
        outbound: [];
    };
    openRegistrations: false;
    usage: {
        users: {
            total: 1;
            activeMonth: 0 | 1;
            activeHalfyear: 0 | 1;
        };
        localPosts: number;
        localComments: number;
    };
    metadata: {
        nodeName: string;
        nodeDescription?: string;
        nodeIcon?: string;
        nodeBanner?: string;
        private: false;
        postFormats: ['text/html'];
    };
}

interface NodeInfo extends Omit<CachedNodeInfo, 'software'> {
    software: Omit<CachedNodeInfo['software'], 'homepage' | 'repository'> & {
        homepage: URL;
        repository: URL;
    };
}

export class NodeInfoService {
    private readonly responseTtl = Temporal.Duration.from({ minutes: 30 });
    private readonly countsTtl = Temporal.Duration.from({ days: 7 });

    constructor(
        private readonly db: Knex,
        private readonly kv: KvStore,
        private readonly logging: Logger,
    ) {}

    async getNodeInfo(site: Site, account: Account): Promise<NodeInfo> {
        const cached = await this.kv.get(this.responseKey(site.id));

        if (this.isCachedNodeInfo(cached)) {
            return this.deserializeNodeInfo(cached);
        }

        const [lastActivityAt, counts] = await Promise.all([
            this.getLastActivityAt(site.id),
            this.getCounts(site.id, account.id),
        ]);

        const nodeInfo: CachedNodeInfo = {
            software: {
                name: 'ghost',
                version: { major: 0, minor: 1, patch: 0 },
                homepage: 'https://ghost.org/',
                repository: 'https://github.com/TryGhost/Ghost',
            },
            protocols: ['activitypub'],
            services: {
                inbound: [],
                outbound: [],
            },
            openRegistrations: false,
            usage: {
                users: {
                    total: 1,
                    activeMonth: this.isActiveWithin(lastActivityAt, 30),
                    activeHalfyear: this.isActiveWithin(lastActivityAt, 180),
                },
                localPosts: counts.localPosts,
                localComments: counts.localComments,
            },
            metadata: this.getMetadata(account),
        };

        await this.kv.set(this.responseKey(site.id), nodeInfo, {
            ttl: this.responseTtl,
        });

        return this.deserializeNodeInfo(nodeInfo);
    }

    async markAccountActive(accountId: number, at = new Date()): Promise<void> {
        const siteId = await this.getSiteIdForAccount(accountId);

        if (siteId === null) {
            return;
        }

        await this.markSiteActive(siteId, at);
    }

    async markPostAuthorActive(postId: number, at = new Date()): Promise<void> {
        const row = await this.db('posts')
            .innerJoin('users', 'users.account_id', 'posts.author_id')
            .where('posts.id', postId)
            .select('users.site_id')
            .first();

        if (!row) {
            return;
        }

        await this.markSiteActive(row.site_id, at);
    }

    private async markSiteActive(siteId: number, at: Date): Promise<void> {
        await this.kv.set(this.lastActivityKey(siteId), at.toISOString());
        await this.kv.delete(this.responseKey(siteId));
    }

    private async getSiteIdForAccount(
        accountId: number,
    ): Promise<number | null> {
        const row = await this.db('users')
            .where('account_id', accountId)
            .select('site_id')
            .first();

        return row?.site_id ?? null;
    }

    private async getLastActivityAt(siteId: number): Promise<Date | null> {
        const value = await this.kv.get(this.lastActivityKey(siteId));

        if (typeof value !== 'string') {
            return null;
        }

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            this.logging.warn('Invalid NodeInfo last activity value', {
                siteId,
                value,
            });
            return null;
        }

        return date;
    }

    private async getCounts(
        siteId: number,
        accountId: number,
    ): Promise<NodeInfoCounts> {
        const cached = await this.kv.get(this.countsKey(siteId));

        if (this.isCounts(cached)) {
            return cached;
        }

        const rows = (await this.db('outboxes')
            .select('outbox_type')
            .count({ count: '*' })
            .where('account_id', accountId)
            .whereIn('outbox_type', [OutboxType.Original, OutboxType.Reply])
            .groupBy('outbox_type')) as {
            outbox_type: OutboxType;
            count: string | number;
        }[];

        const counts = rows.reduce<NodeInfoCounts>(
            (acc, row) => {
                const count = Number(row.count);

                if (row.outbox_type === OutboxType.Original) {
                    acc.localPosts = count;
                }

                if (row.outbox_type === OutboxType.Reply) {
                    acc.localComments = count;
                }

                return acc;
            },
            { localPosts: 0, localComments: 0 },
        );

        await this.kv.set(this.countsKey(siteId), counts, {
            ttl: this.countsTtl,
        });

        return counts;
    }

    private getMetadata(account: Account): CachedNodeInfo['metadata'] {
        return {
            nodeName: account.name ?? account.url.hostname,
            ...(account.bio ? { nodeDescription: account.bio } : {}),
            ...(account.avatarUrl ? { nodeIcon: account.avatarUrl.href } : {}),
            ...(account.bannerImageUrl
                ? { nodeBanner: account.bannerImageUrl.href }
                : {}),
            private: false,
            postFormats: ['text/html'],
        };
    }

    private isActiveWithin(lastActivityAt: Date | null, days: number): 0 | 1 {
        if (lastActivityAt === null) {
            return 0;
        }

        const activeSince = Date.now() - days * 24 * 60 * 60 * 1000;

        return lastActivityAt.getTime() >= activeSince ? 1 : 0;
    }

    private responseKey(siteId: number): KvKey {
        return ['nodeinfo', 'response', String(siteId)];
    }

    private countsKey(siteId: number): KvKey {
        return ['nodeinfo', 'counts', String(siteId)];
    }

    private lastActivityKey(siteId: number): KvKey {
        return ['nodeinfo', 'lastActivityAt', String(siteId)];
    }

    private isCounts(value: unknown): value is NodeInfoCounts {
        return (
            value !== null &&
            typeof value === 'object' &&
            'localPosts' in value &&
            'localComments' in value &&
            typeof value.localPosts === 'number' &&
            typeof value.localComments === 'number'
        );
    }

    private isCachedNodeInfo(value: unknown): value is CachedNodeInfo {
        if (value === null || typeof value !== 'object') {
            return false;
        }

        const nodeInfo = value as Partial<CachedNodeInfo>;

        return (
            nodeInfo.software?.name === 'ghost' &&
            this.isUrlString(nodeInfo.software.homepage) &&
            this.isUrlString(nodeInfo.software.repository) &&
            Array.isArray(nodeInfo.protocols) &&
            nodeInfo.protocols.includes('activitypub') &&
            nodeInfo.usage?.users?.total === 1 &&
            typeof nodeInfo.usage.localPosts === 'number' &&
            typeof nodeInfo.usage.localComments === 'number' &&
            nodeInfo.metadata?.private === false
        );
    }

    private isUrlString(value: unknown): value is string {
        if (typeof value !== 'string') {
            return false;
        }

        try {
            new URL(value);
            return true;
        } catch {
            return false;
        }
    }

    private deserializeNodeInfo(nodeInfo: CachedNodeInfo): NodeInfo {
        return {
            ...nodeInfo,
            software: {
                ...nodeInfo.software,
                homepage: new URL(nodeInfo.software.homepage),
                repository: new URL(nodeInfo.software.repository),
            },
        };
    }
}
