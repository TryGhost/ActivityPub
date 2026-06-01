import { describe, expect, it, vi } from 'vitest';

import type { KvKey, KvStore, KvStoreSetOptions } from '@fedify/fedify';
import type { Logger } from '@logtape/logtape';
import type { Knex } from 'knex';

import type { Account } from '@/account/account.entity';
import { NodeInfoService } from '@/activitypub/nodeinfo.service';
import { OutboxType } from '@/post/post.entity';
import type { Site } from '@/site/site.service';

class FakeKvStore implements KvStore {
    values = new Map<string, unknown>();
    setCalls: { key: KvKey; value: unknown; options?: KvStoreSetOptions }[] =
        [];

    async get<T = unknown>(key: KvKey): Promise<T | undefined> {
        return this.values.get(JSON.stringify(key)) as T | undefined;
    }

    async set(key: KvKey, value: unknown, options?: KvStoreSetOptions) {
        this.values.set(JSON.stringify(key), value);
        this.setCalls.push({ key, value, options });
    }

    async delete(key: KvKey) {
        this.values.delete(JSON.stringify(key));
    }
}

class FailingSetKvStore extends FakeKvStore {
    async set(): Promise<void> {
        throw new Error('cache unavailable');
    }
}

class FailingGetKvStore extends FakeKvStore {
    async get<T = unknown>(): Promise<T | undefined> {
        throw new Error('cache unavailable');
    }
}

function createDbReturningStats(row: unknown): Knex {
    return {
        raw: vi.fn().mockResolvedValue([[row], []]),
    } as unknown as Knex;
}

function createLogger(): Logger {
    return {
        warn: vi.fn(),
    } as unknown as Logger;
}

const site: Site = {
    id: 123,
    host: 'example.com',
    webhook_secret: 'secret',
    ghost_uuid: '87f39539-99d0-4d4f-ad6c-e483ba54caa7',
};

const account = {
    id: 456,
} as Account;

describe('NodeInfoService', () => {
    it('uses cached NodeInfo data before querying stats', async () => {
        const kv = new FakeKvStore();
        const cached = {
            lastActivityAt: new Date('2026-01-01T00:00:00Z').toISOString(),
            localPosts: 4,
            localComments: 2,
        };
        kv.values.set(
            JSON.stringify(['nodeinfo', 'data', String(site.id)]),
            cached,
        );
        const db = createDbReturningStats({});

        const service = new NodeInfoService(db, kv, createLogger());

        const data = await service.getData(site, account);

        expect(data).toEqual({
            lastActivityAt: new Date('2026-01-01T00:00:00Z'),
            localPosts: 4,
            localComments: 2,
        });
        expect(db.raw).not.toHaveBeenCalled();
    });

    it('queries and caches stats on cache miss', async () => {
        const kv = new FakeKvStore();
        const db = createDbReturningStats({
            last_activity_at: new Date('2026-02-03T04:05:06Z'),
            local_posts: '5',
            local_comments: '8',
        });
        const service = new NodeInfoService(db, kv, createLogger());

        const data = await service.getData(site, account);

        expect(data).toEqual({
            lastActivityAt: new Date('2026-02-03T04:05:06Z'),
            localPosts: 5,
            localComments: 8,
        });
        expect(db.raw).toHaveBeenCalledWith(expect.stringContaining('SELECT'), [
            account.id,
            OutboxType.Original,
            account.id,
            OutboxType.Repost,
            account.id,
            OutboxType.Reply,
            account.id,
            account.id,
            account.id,
            OutboxType.Original,
            account.id,
            OutboxType.Reply,
        ]);
        expect(kv.setCalls).toEqual([
            expect.objectContaining({
                key: ['nodeinfo', 'data', String(site.id)],
                value: {
                    lastActivityAt: '2026-02-03T04:05:06.000Z',
                    localPosts: 5,
                    localComments: 8,
                },
            }),
        ]);
        expect(kv.setCalls[0].options?.ttl?.total('minutes')).toBe(30);
    });

    it('treats the SQL epoch fallback as no activity', async () => {
        const kv = new FakeKvStore();
        const service = new NodeInfoService(
            createDbReturningStats({
                last_activity_at: '1970-01-01',
                local_posts: 0,
                local_comments: 0,
            }),
            kv,
            createLogger(),
        );

        const data = await service.getData(site, account);

        expect(data.lastActivityAt).toBeNull();
    });

    it('returns fresh stats when caching fails', async () => {
        const logger = createLogger();
        const service = new NodeInfoService(
            createDbReturningStats({
                last_activity_at: new Date('2026-02-03T04:05:06Z'),
                local_posts: '5',
                local_comments: '8',
            }),
            new FailingSetKvStore(),
            logger,
        );

        const data = await service.getData(site, account);

        expect(data).toEqual({
            lastActivityAt: new Date('2026-02-03T04:05:06Z'),
            localPosts: 5,
            localComments: 8,
        });
        expect(logger.warn).toHaveBeenCalledWith(
            'NodeInfo: failed to cache stats',
            expect.objectContaining({ siteId: site.id }),
        );
    });

    it('returns fresh stats when reading from cache fails', async () => {
        const logger = createLogger();
        const service = new NodeInfoService(
            createDbReturningStats({
                last_activity_at: new Date('2026-02-03T04:05:06Z'),
                local_posts: '5',
                local_comments: '8',
            }),
            new FailingGetKvStore(),
            logger,
        );

        const data = await service.getData(site, account);

        expect(data).toEqual({
            lastActivityAt: new Date('2026-02-03T04:05:06Z'),
            localPosts: 5,
            localComments: 8,
        });
        expect(logger.warn).toHaveBeenCalledWith(
            'NodeInfo: failed to read cached stats',
            expect.objectContaining({ siteId: site.id }),
        );
    });
});
