import { beforeAll, describe, expect, it } from 'vitest';

import type { KvKey } from '@fedify/fedify';
import { Temporal } from '@js-temporal/polyfill';
import type { Knex } from 'knex';
import { createTestDb } from 'test/db';
import { KnexKvStore } from './knex.kvstore';

describe('KnexKvStore', () => {
    let client: Knex;

    beforeAll(async () => {
        client = await createTestDb();
    });
    it('Implements a basic KvStore', async () => {
        const table = 'key_value';
        const store = KnexKvStore.create(client, table);

        // checkReadingUnsetKey
        {
            const actual = await store.get(['unsetkey']);
            const expected = null;
            expect(actual).toEqual(expected);
        }

        // checkReadingSetKey
        {
            await store.set(['setkey'], { hello: 'world' });
            const actual = await store.get(['setkey']);
            const expected = { hello: 'world' };
            expect(actual).toEqual(expected);
        }

        // checkUpdatingKey
        {
            await store.set(['updated'], { initial: 'value' });
            await store.set(['updated'], { updated: 'value' });
            const actual = await store.get(['updated']);
            const expected = { updated: 'value' };
            expect(actual).toEqual(expected);
        }

        // checkDeletingKey
        {
            await store.set(['deleted'], { initial: 'value' });
            await store.delete(['deleted']);
            const actual = await store.get(['deleted']);
            const expected = null;
            expect(actual).toEqual(expected);
        }
    });

    it('Can store boolean values', async () => {
        const table = 'key_value';
        const store = KnexKvStore.create(client, table);

        // checkTrue
        {
            await store.set(['boolean_true'], true);
            const actual = await store.get(['boolean_true']);
            const expected = true;
            expect(actual).toEqual(expected);
        }

        // checkFalse
        {
            await store.set(['boolean_false'], false);
            const actual = await store.get(['boolean_false']);
            const expected = false;
            expect(actual).toEqual(expected);
        }
    });

    it('Can handle concurrent calls', async () => {
        const table = 'key_value';
        const store = KnexKvStore.create(client, table);

        const calls = [
            store.set(['concurrent'], true),
            store.set(['concurrent'], true),
            store.set(['concurrent'], true),
            store.set(['concurrent'], true),
            store.set(['concurrent'], true),
            store.set(['concurrent'], true),
            store.set(['concurrent'], true),
            store.set(['concurrent'], true),
            store.set(['concurrent'], true),
        ];

        await Promise.all(calls);
    });

    it('Can handle storing ttl', async () => {
        const table = 'key_value';
        const store = KnexKvStore.create(client, table);

        await store.set(['will-expire'], 'hello', {
            ttl: Temporal.Duration.from({ days: 1 }),
        });

        const row = await client('key_value')
            .where({
                key: JSON.stringify(['will-expire']),
            })
            .first();

        expect(row.expires).not.toBeNull();
        expect(row.expires).toBeInstanceOf(Date);

        const now = new Date();
        const diff = row.expires.getTime() - now.getTime();

        const differenceFromOneDay = Math.abs(diff - 1000 * 60 * 60 * 24);

        expect(differenceFromOneDay).toBeLessThan(1000);
    });

    describe('Activity idempotence origin filtering', () => {
        it('Should filter origin from fedify activity idempotence keys when enabled', async () => {
            const table = 'key_value';
            const store = KnexKvStore.create(client, table, {
                filterActivityIdempotenceOrigin: true,
            });

            const testValue = { test: 'data' };
            const origin = 'https://example.com';
            const activityUrl = 'https://example.com/activity/123';
            const keyWithOrigin: KvKey = [
                '_fedify',
                'activityIdempotence',
                origin,
                activityUrl,
            ];
            const expectedFilteredKey: KvKey = [
                '_fedify',
                'activityIdempotence',
                activityUrl,
            ];

            // Set value with origin in key
            await store.set(keyWithOrigin, testValue);

            // Verify the key was stored without the origin
            const row = await client(table)
                .where({
                    key: JSON.stringify(expectedFilteredKey),
                })
                .first();

            expect(row).toBeTruthy();
            expect(row.value).toEqual(testValue);

            // Verify we can retrieve it with the original key (with origin)
            const retrievedValue = await store.get(keyWithOrigin);
            expect(retrievedValue).toEqual(testValue);

            // Verify we can also retrieve it with a different origin
            const keyWithDifferentOrigin: KvKey = [
                '_fedify',
                'activityIdempotence',
                'https://different.com',
                activityUrl,
            ];
            const retrievedWithDifferentOrigin = await store.get(
                keyWithDifferentOrigin,
            );
            expect(retrievedWithDifferentOrigin).toEqual(testValue);
        });

        it('Should not filter origin when disabled', async () => {
            const table = 'key_value';
            const store = KnexKvStore.create(client, table, {
                filterActivityIdempotenceOrigin: false,
            });

            const testValue = { test: 'data' };
            const origin = 'https://example.com';
            const activityUrl = 'https://example.com/activity/456';
            const keyWithOrigin: KvKey = [
                '_fedify',
                'activityIdempotence',
                origin,
                activityUrl,
            ];

            // Set value with origin in key
            await store.set(keyWithOrigin, testValue);

            // Verify the key was stored with the origin
            const row = await client(table)
                .where({
                    key: JSON.stringify(keyWithOrigin),
                })
                .first();

            expect(row).toBeTruthy();
            expect(row.value).toEqual(testValue);

            // Verify we can retrieve it with the same key
            const retrievedValue = await store.get(keyWithOrigin);
            expect(retrievedValue).toEqual(testValue);

            // Verify we cannot retrieve it with a different origin
            const keyWithDifferentOrigin: KvKey = [
                '_fedify',
                'activityIdempotence',
                'https://different.com',
                activityUrl,
            ];
            const retrievedWithDifferentOrigin = await store.get(
                keyWithDifferentOrigin,
            );
            expect(retrievedWithDifferentOrigin).toBeNull();
        });

        it('Should not affect other key types when filtering is enabled', async () => {
            const table = 'key_value';
            const store = KnexKvStore.create(client, table, {
                filterActivityIdempotenceOrigin: true,
            });

            // Test various key types that should not be affected
            const testCases = [
                { key: ['simple'] as KvKey, value: 'test1' },
                { key: ['_fedify', 'other'] as KvKey, value: 'test2' },
                {
                    key: ['_fedify', 'activityIdempotence'] as KvKey,
                    value: 'test3',
                }, // Wrong length
                {
                    key: [
                        '_fedify',
                        'activityIdempotence',
                        'extra',
                        'params',
                        'more',
                    ] as KvKey,
                    value: 'test4',
                }, // Wrong length
                {
                    key: [
                        'not_fedify',
                        'activityIdempotence',
                        'origin',
                        'url',
                    ] as KvKey,
                    value: 'test5',
                }, // Wrong prefix
            ];

            for (const { key, value } of testCases) {
                await store.set(key, value);
                const retrieved = await store.get(key);
                expect(retrieved).toEqual(value);

                // Verify exact key was stored
                const row = await client(table)
                    .where({
                        key: JSON.stringify(key),
                    })
                    .first();
                expect(row).toBeTruthy();
            }
        });

        it('Should handle delete operations correctly with filtering enabled', async () => {
            const table = 'key_value';
            const store = KnexKvStore.create(client, table, {
                filterActivityIdempotenceOrigin: true,
            });

            const testValue = { test: 'delete-test' };
            const origin = 'https://example.com';
            const activityUrl = 'https://example.com/activity/789';
            const keyWithOrigin: KvKey = [
                '_fedify',
                'activityIdempotence',
                origin,
                activityUrl,
            ];

            // Set and then delete
            await store.set(keyWithOrigin, testValue);
            await store.delete(keyWithOrigin);

            // Verify it's deleted
            const retrieved = await store.get(keyWithOrigin);
            expect(retrieved).toBeNull();

            // Also verify with a different origin
            const keyWithDifferentOrigin: KvKey = [
                '_fedify',
                'activityIdempotence',
                'https://different.com',
                activityUrl,
            ];
            const retrievedDifferent = await store.get(keyWithDifferentOrigin);
            expect(retrievedDifferent).toBeNull();
        });
    });
});
