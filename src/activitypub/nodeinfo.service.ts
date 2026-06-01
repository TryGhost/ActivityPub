import type { KvKey, KvStore } from '@fedify/fedify';
import { Temporal } from '@js-temporal/polyfill';
import type { Logger } from '@logtape/logtape';
import type { Knex } from 'knex';

import type { Account } from '@/account/account.entity';
import { OutboxType } from '@/post/post.entity';
import type { Site } from '@/site/site.service';

export interface NodeInfoData {
    lastActivityAt: Date | null;
    localPosts: number;
    localComments: number;
}

interface CachedNodeInfoData {
    lastActivityAt: string | null;
    localPosts: number;
    localComments: number;
}

interface NodeInfoStatsRow {
    last_activity_at: Date | string | null;
    local_posts: number | string;
    local_comments: number | string;
}

export class NodeInfoService {
    private readonly dataTtl = Temporal.Duration.from({ minutes: 30 });

    constructor(
        private readonly db: Knex,
        private readonly kv: KvStore,
        private readonly logging: Logger,
    ) {}

    async getData(site: Site, account: Account): Promise<NodeInfoData> {
        let cached: unknown;
        try {
            cached = await this.kv.get(this.dataKey(site.id));
        } catch (err) {
            this.logging.warn('NodeInfo: failed to read cached stats', {
                error: err,
                siteId: site.id,
            });
        }

        if (this.isCachedNodeInfoData(cached)) {
            return this.deserialize(cached);
        }

        const data = await this.queryStats(account.id);

        try {
            await this.kv.set(this.dataKey(site.id), this.serialize(data), {
                ttl: this.dataTtl,
            });
        } catch (err) {
            this.logging.warn('NodeInfo: failed to cache stats', {
                error: err,
                siteId: site.id,
            });
        }

        return data;
    }

    private async queryStats(accountId: number): Promise<NodeInfoData> {
        // This intentionally derives activity from retained rows only. Exact
        // destructive activity tracking would require separate durable state.
        const [[row]] = (await this.db.raw(
            `
            SELECT
                GREATEST(
                    COALESCE((SELECT published_at FROM outboxes FORCE INDEX (idx_outboxes_account_id_outbox_type_published_at_desc) WHERE account_id = ? AND outbox_type = ? ORDER BY published_at DESC LIMIT 1), '1970-01-01'),
                    COALESCE((SELECT published_at FROM outboxes FORCE INDEX (idx_outboxes_account_id_outbox_type_published_at_desc) WHERE account_id = ? AND outbox_type = ? ORDER BY published_at DESC LIMIT 1), '1970-01-01'),
                    COALESCE((SELECT published_at FROM outboxes FORCE INDEX (idx_outboxes_account_id_outbox_type_published_at_desc) WHERE account_id = ? AND outbox_type = ? ORDER BY published_at DESC LIMIT 1), '1970-01-01'),
                    COALESCE((SELECT MAX(created_at) FROM likes WHERE account_id = ?), '1970-01-01'),
                    COALESCE((SELECT MAX(created_at) FROM follows WHERE follower_id = ?), '1970-01-01')
                ) AS last_activity_at,
                (
                    SELECT COUNT(*) FROM outboxes
                    FORCE INDEX (idx_outboxes_account_id_outbox_type_published_at_desc)
                    WHERE account_id = ? AND outbox_type = ?
                ) AS local_posts,
                (
                    SELECT COUNT(*) FROM outboxes
                    FORCE INDEX (idx_outboxes_account_id_outbox_type_published_at_desc)
                    WHERE account_id = ? AND outbox_type = ?
                ) AS local_comments
            `,
            [
                accountId,
                OutboxType.Original,
                accountId,
                OutboxType.Repost,
                accountId,
                OutboxType.Reply,
                accountId,
                accountId,
                accountId,
                OutboxType.Original,
                accountId,
                OutboxType.Reply,
            ],
        )) as [NodeInfoStatsRow[], unknown];

        return {
            lastActivityAt: this.parseLastActivityAt(row.last_activity_at),
            localPosts: Number(row.local_posts),
            localComments: Number(row.local_comments),
        };
    }

    private parseLastActivityAt(value: Date | string | null): Date | null {
        if (value === null) {
            return null;
        }

        const date = value instanceof Date ? value : new Date(value);

        if (Number.isNaN(date.getTime()) || date.getTime() === 0) {
            return null;
        }

        return date;
    }

    private serialize(data: NodeInfoData): CachedNodeInfoData {
        return {
            lastActivityAt: data.lastActivityAt?.toISOString() ?? null,
            localPosts: data.localPosts,
            localComments: data.localComments,
        };
    }

    private deserialize(data: CachedNodeInfoData): NodeInfoData {
        return {
            lastActivityAt:
                data.lastActivityAt === null
                    ? null
                    : new Date(data.lastActivityAt),
            localPosts: data.localPosts,
            localComments: data.localComments,
        };
    }

    private dataKey(siteId: number): KvKey {
        return ['nodeinfo', 'data', String(siteId)];
    }

    private isCachedNodeInfoData(value: unknown): value is CachedNodeInfoData {
        return (
            value !== null &&
            typeof value === 'object' &&
            'lastActivityAt' in value &&
            (value.lastActivityAt === null ||
                typeof value.lastActivityAt === 'string') &&
            'localPosts' in value &&
            typeof value.localPosts === 'number' &&
            'localComments' in value &&
            typeof value.localComments === 'number'
        );
    }
}
