import assert from 'assert';
import { KnexKvStore } from './knex.kvstore';
import { client } from './db';

after(async function () {
    await client.destroy();
});

describe('KnexKvStore', function () {
    it('Implements a basic KvStore', async function () {
        const table = 'key_value';
        const store = await KnexKvStore.create(client, table);

        checkReadingUnsetKey: {
            const actual = await store.get(['unsetkey']);
            const expected = null;
            assert.equal(actual, expected);
            break checkReadingUnsetKey;
        }

        checkReadingSetKey: {
            await store.set(['setkey'], { hello: 'world' });
            const actual = await store.get(['setkey']);
            const expected = { hello: 'world' };
            assert.deepEqual(actual, expected);
            break checkReadingSetKey;
        }

        checkUpdatingKey: {
            await store.set(['updated'], { initial: 'value' });
            await store.set(['updated'], { updated: 'value' });
            const actual = await store.get(['updated']);
            const expected = { updated: 'value' };
            assert.deepEqual(actual, expected);
            break checkUpdatingKey;
        }

        checkDeletingKey: {
            await store.set(['deleted'], { initial: 'value' });
            await store.delete(['deleted']);
            const actual = await store.get(['deleted']);
            const expected = null;
            assert.deepEqual(actual, expected);
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
            assert.equal(actual, expected);
            break checkTrue;
        }

        checkFalse: {
            await store.set(['boolean_false'], false);
            const actual = await store.get(['boolean_false']);
            const expected = false;
            assert.equal(actual, expected);
            break checkFalse;
        }
    });
});
