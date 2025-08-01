import { beforeAll, describe, expect, it } from 'vitest';

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
});
