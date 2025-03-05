import { beforeAll, describe, expect, it } from 'vitest';

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
        const store = await KnexKvStore.create(client, table);

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
        const store = await KnexKvStore.create(client, table);

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
});
