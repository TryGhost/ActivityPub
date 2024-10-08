import { afterAll, describe, expect, it } from 'vitest';

import { KnexKvStore } from './knex.kvstore';
import { client } from './db';

afterAll(async function () {
    await client.destroy();
});

describe('KnexKvStore', function () {
    it('Implements a basic KvStore', async function () {
        const table = 'key_value';
        const store = await KnexKvStore.create(client, table);

        checkReadingUnsetKey: {
            const actual = await store.get(['unsetkey']);
            const expected = null;
            expect(actual).toEqual(expected);
            break checkReadingUnsetKey;
        }

        checkReadingSetKey: {
            await store.set(['setkey'], { hello: 'world' });
            const actual = await store.get(['setkey']);
            const expected = { hello: 'world' };
            expect(actual).toEqual(expected);
            break checkReadingSetKey;
        }

        checkUpdatingKey: {
            await store.set(['updated'], { initial: 'value' });
            await store.set(['updated'], { updated: 'value' });
            const actual = await store.get(['updated']);
            const expected = { updated: 'value' };
            expect(actual).toEqual(expected);
            break checkUpdatingKey;
        }

        checkDeletingKey: {
            await store.set(['deleted'], { initial: 'value' });
            await store.delete(['deleted']);
            const actual = await store.get(['deleted']);
            const expected = null;
            expect(actual).toEqual(expected);
            break checkDeletingKey;
        }
    });

    it('Can store boolean values', async function () {
        const table = 'key_value';
        const store = await KnexKvStore.create(client, table);

        checkTrue: {
            await store.set(['boolean_true'], true);
            const actual = await store.get(['boolean_true']);
            const expected = true;
            expect(actual).toEqual(expected);
            break checkTrue;
        }

        checkFalse: {
            await store.set(['boolean_false'], false);
            const actual = await store.get(['boolean_false']);
            const expected = false;
            expect(actual).toEqual(expected);
            break checkFalse;
        }
    });
});
