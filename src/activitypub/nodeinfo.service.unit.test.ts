import { describe, expect, it, vi } from 'vitest';

import type { KvKey, KvStore, KvStoreSetOptions } from '@fedify/fedify';
import type { Logger } from '@logtape/logtape';
import type { Knex } from 'knex';

import type { Account } from '@/account/account.entity';
import { NodeInfoService } from '@/activitypub/nodeinfo.service';
import type { Site } from '@/site/site.service';

class FakeKvStore implements KvStore {
    values = new Map<string, unknown>();
    setCalls: { key: KvKey; value: unknown; options?: KvStoreSetOptions }[] =
        [];
    deleteCalls: KvKey[] = [];

    async get<T = unknown>(key: KvKey): Promise<T | undefined> {
        return this.values.get(JSON.stringify(key)) as T | undefined;
    }

    async set(key: KvKey, value: unknown, options?: KvStoreSetOptions) {
        this.values.set(JSON.stringify(key), value);
        this.setCalls.push({ key, value, options });
    }

    async delete(key: KvKey) {
        this.values.delete(JSON.stringify(key));
        this.deleteCalls.push(key);
    }
}

function createDbReturningCounts(rows: unknown[]): Knex {
    const builder = {
        select: vi.fn().mockReturnThis(),
        count: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        whereIn: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockResolvedValue(rows),
    };

    return vi.fn().mockReturnValue(builder) as unknown as Knex;
}

const site: Site = {
    id: 123,
    host: 'example.com',
    webhook_secret: 'secret',
    ghost_uuid: '87f39539-99d0-4d4f-ad6c-e483ba54caa7',
};

const account = {
    id: 456,
    name: 'Example Site',
    bio: 'Example description',
    url: new URL('https://example.com/'),
    avatarUrl: new URL('https://example.com/icon.png'),
    bannerImageUrl: new URL('https://example.com/banner.png'),
} as Account;

const logger = {
    warn: vi.fn(),
} as unknown as Logger;

describe('NodeInfoService', () => {
    it('builds active user fields from last activity', async () => {
        const kv = new FakeKvStore();
        kv.values.set(
            JSON.stringify(['nodeinfo', 'lastActivityAt', String(site.id)]),
            new Date().toISOString(),
        );
        kv.values.set(JSON.stringify(['nodeinfo', 'counts', String(site.id)]), {
            localPosts: 4,
            localComments: 2,
        });
        const db = createDbReturningCounts([]);

        const service = new NodeInfoService(db, kv, logger);

        const nodeInfo = await service.getNodeInfo(site, account);

        expect(nodeInfo.usage.users).toEqual({
            total: 1,
            activeMonth: 1,
            activeHalfyear: 1,
        });
        expect(nodeInfo.usage.localPosts).toBe(4);
        expect(nodeInfo.usage.localComments).toBe(2);
        expect(db).not.toHaveBeenCalled();
        expect(nodeInfo.metadata).toEqual({
            nodeName: 'Example Site',
            nodeDescription: 'Example description',
            nodeIcon: 'https://example.com/icon.png',
            nodeBanner: 'https://example.com/banner.png',
            private: false,
            postFormats: ['text/html'],
        });
    });

    it('sets active windows from the last activity age', async () => {
        const cases = [
            {
                lastActivityAt: null,
                activeMonth: 0,
                activeHalfyear: 0,
            },
            {
                lastActivityAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
                activeMonth: 0,
                activeHalfyear: 1,
            },
            {
                lastActivityAt: new Date(
                    Date.now() - 181 * 24 * 60 * 60 * 1000,
                ),
                activeMonth: 0,
                activeHalfyear: 0,
            },
        ] as const;

        for (const testCase of cases) {
            const kv = new FakeKvStore();
            kv.values.set(
                JSON.stringify(['nodeinfo', 'counts', String(site.id)]),
                { localPosts: 0, localComments: 0 },
            );

            if (testCase.lastActivityAt) {
                kv.values.set(
                    JSON.stringify([
                        'nodeinfo',
                        'lastActivityAt',
                        String(site.id),
                    ]),
                    testCase.lastActivityAt.toISOString(),
                );
            }

            const service = new NodeInfoService(
                createDbReturningCounts([]),
                kv,
                logger,
            );

            const nodeInfo = await service.getNodeInfo(site, account);

            expect(nodeInfo.usage.users.activeMonth).toBe(testCase.activeMonth);
            expect(nodeInfo.usage.users.activeHalfyear).toBe(
                testCase.activeHalfyear,
            );
        }
    });

    it('uses the rendered response cache before reading counts', async () => {
        const kv = new FakeKvStore();
        const cachedNodeInfo = {
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
                    activeMonth: 0,
                    activeHalfyear: 1,
                },
                localPosts: 7,
                localComments: 3,
            },
            metadata: {
                nodeName: 'Cached Site',
                private: false,
                postFormats: ['text/html'],
            },
        };
        kv.values.set(
            JSON.stringify(['nodeinfo', 'response', String(site.id)]),
            cachedNodeInfo,
        );
        const db = createDbReturningCounts([]);

        const service = new NodeInfoService(db, kv, logger);

        const nodeInfo = await service.getNodeInfo(site, account);

        expect(nodeInfo.software.homepage).toEqual(
            new URL('https://ghost.org/'),
        );
        expect(nodeInfo.usage.localPosts).toBe(7);
        expect(db).not.toHaveBeenCalled();
    });

    it('rebuilds the response when cached software URLs are malformed', async () => {
        const kv = new FakeKvStore();
        kv.values.set(
            JSON.stringify(['nodeinfo', 'response', String(site.id)]),
            {
                software: {
                    name: 'ghost',
                    version: { major: 0, minor: 1, patch: 0 },
                    homepage: 'not a url',
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
                        activeMonth: 0,
                        activeHalfyear: 1,
                    },
                    localPosts: 7,
                    localComments: 3,
                },
                metadata: {
                    nodeName: 'Cached Site',
                    private: false,
                    postFormats: ['text/html'],
                },
            },
        );
        kv.values.set(JSON.stringify(['nodeinfo', 'counts', String(site.id)]), {
            localPosts: 4,
            localComments: 2,
        });
        const db = createDbReturningCounts([]);

        const service = new NodeInfoService(db, kv, logger);

        const nodeInfo = await service.getNodeInfo(site, account);

        expect(nodeInfo.software.homepage).toEqual(
            new URL('https://ghost.org/'),
        );
        expect(nodeInfo.usage.localPosts).toBe(4);
        expect(db).not.toHaveBeenCalled();
    });

    it('caches outbox counts for 7 days on count cache miss', async () => {
        const kv = new FakeKvStore();
        const service = new NodeInfoService(
            createDbReturningCounts([
                { outbox_type: 0, count: '5' },
                { outbox_type: 2, count: '8' },
            ]),
            kv,
            logger,
        );

        const nodeInfo = await service.getNodeInfo(site, account);

        expect(nodeInfo.usage.localPosts).toBe(5);
        expect(nodeInfo.usage.localComments).toBe(8);
        expect(kv.setCalls).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    key: ['nodeinfo', 'counts', String(site.id)],
                    value: { localPosts: 5, localComments: 8 },
                }),
            ]),
        );
        expect(
            kv.setCalls
                .find(
                    (call) =>
                        JSON.stringify(call.key) ===
                        JSON.stringify(['nodeinfo', 'counts', String(site.id)]),
                )
                ?.options?.ttl?.total('days'),
        ).toBe(7);
        expect(
            kv.setCalls
                .find(
                    (call) =>
                        JSON.stringify(call.key) ===
                        JSON.stringify([
                            'nodeinfo',
                            'response',
                            String(site.id),
                        ]),
                )
                ?.options?.ttl?.total('minutes'),
        ).toBe(30);
    });
});
