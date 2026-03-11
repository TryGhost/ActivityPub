import { beforeAll, describe, expect, it } from 'vitest';

import { Temporal } from '@js-temporal/polyfill';
import { getLogger } from '@logtape/logtape';
import type { Knex } from 'knex';

import { KnexKvStore } from '@/knex.kvstore';
import { createTestDb } from '@/test/db';

describe('KnexKvStore', () => {
    let client: Knex;
    const logger = getLogger(['test', 'knex-kvstore']);

    beforeAll(async () => {
        client = await createTestDb();
    });
    it('Implements a basic KvStore', async () => {
        const table = 'key_value';
        const store = KnexKvStore.create(client, table, logger);

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
        const store = KnexKvStore.create(client, table, logger);

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
        const store = KnexKvStore.create(client, table, logger);

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
        const store = KnexKvStore.create(client, table, logger);

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

    it('Does not return expired entries', async () => {
        const table = 'key_value';
        const store = KnexKvStore.create(client, table, logger);

        await client(table)
            .insert({
                key: JSON.stringify(['expired-key']),
                value: JSON.stringify({ stale: 'data' }),
                expires: new Date(Date.now() - 1000),
            })
            .onConflict('key')
            .merge(['value', 'expires']);

        const result = await store.get(['expired-key']);

        expect(result).toBeNull();
    });

    it('Deletes expired entries from the database on read', async () => {
        const table = 'key_value';
        const store = KnexKvStore.create(client, table, logger);

        const keyString = JSON.stringify(['expired-key-cleanup']);
        await client(table)
            .insert({
                key: keyString,
                value: JSON.stringify({ stale: 'data' }),
                expires: new Date(Date.now() - 1000),
            })
            .onConflict('key')
            .merge(['value', 'expires']);

        await store.get(['expired-key-cleanup']);

        const row = await client(table).where({ key: keyString }).first();

        expect(row).toBeUndefined();
    });

    it('Returns entries with a future expiry', async () => {
        const table = 'key_value';
        const store = KnexKvStore.create(client, table, logger);

        await store.set(
            ['future-expiry'],
            { fresh: 'data' },
            {
                ttl: Temporal.Duration.from({ hours: 1 }),
            },
        );

        const result = await store.get(['future-expiry']);

        expect(result).toEqual({ fresh: 'data' });
    });

    it('Returns entries with no expiry', async () => {
        const table = 'key_value';
        const store = KnexKvStore.create(client, table, logger);

        await store.set(['no-expiry'], { persistent: 'data' });

        const result = await store.get(['no-expiry']);

        expect(result).toEqual({ persistent: 'data' });
    });

    it('Cleans up expired rows on set() after cleanup interval is reached', async () => {
        const table = 'key_value';

        // Cleanup every 3 set() calls
        const store = KnexKvStore.create(client, table, logger, 3);

        // Insert expired rows directly
        const expiredKeys = ['cleanup-a', 'cleanup-b', 'cleanup-c'];
        for (const k of expiredKeys) {
            await client(table)
                .insert({
                    key: JSON.stringify([k]),
                    value: JSON.stringify({ stale: 'data' }),
                    expires: new Date(Date.now() - 1000),
                })
                .onConflict('key')
                .merge(['value', 'expires']);
        }

        // Insert a non-expired row that should survive cleanup
        const nonExpiredKey = JSON.stringify(['cleanup-survivor']);
        await client(table)
            .insert({
                key: nonExpiredKey,
                value: JSON.stringify({ fresh: 'data' }),
                expires: new Date(Date.now() + 60000),
            })
            .onConflict('key')
            .merge(['value', 'expires']);

        // First two set() calls should not trigger cleanup
        await store.set(['trigger-1'], 'value');
        await store.set(['trigger-2'], 'value');

        const remainingBeforeCleanup = await client(table).whereIn(
            'key',
            expiredKeys.map((k) => JSON.stringify([k])),
        );
        expect(remainingBeforeCleanup).toHaveLength(3);

        // Third set() call triggers cleanup
        await store.set(['trigger-3'], 'value');

        const remainingAfterCleanup = await client(table).whereIn(
            'key',
            expiredKeys.map((k) => JSON.stringify([k])),
        );

        expect(remainingAfterCleanup).toHaveLength(0);

        // Non-expired row should still exist
        const survivor = await client(table)
            .where({ key: nonExpiredKey })
            .first();

        expect(survivor).toBeDefined();
    });
});
