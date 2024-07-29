import assert from 'assert';
import { MemoryKvStore } from '@fedify/fedify';
import { addToList, removeFromList, scopeKvStore } from './kv-helpers';

describe('Kv Helpers', function () {
    describe('scopeKvStore', function () {
        it('Returns a scoped KvStore', async function () {
            const store = new MemoryKvStore();
            const scopedStore = scopeKvStore(store, ['scoped']);

            await scopedStore.set(['key'], { value: 'da value' });

            checkIsScoped: {
                const actual = await store.get(['key']);
                const expected = null;
                assert.equal(actual, expected);
                break checkIsScoped;
            }

            checkIsSet: {
                const actual = await scopedStore.get(['key']);
                const expected = { value: 'da value' };
                assert.deepEqual(actual, expected);
                break checkIsSet;
            }

            checkDeletes: {
                await scopedStore.delete(['key']);
                const actual = await scopedStore.get(['key']);
                const expected = null;
                assert.deepEqual(actual, expected);
                break checkDeletes;
            }
        });
    });

    describe('addToList', function () {
        it('Appends items to a key, whether it exists or not', async function () {
            const store = new MemoryKvStore();

            checkNonExisting: {
                await addToList(store, ['not-existing'], 'first');
                const actual = await store.get(['not-existing']);
                const expected = ['first'];
                assert.deepEqual(actual, expected);
                break checkNonExisting;
            }

            checkExisting: {
                await store.set(['existing'], ['first']);
                await addToList(store, ['existing'], 'second');
                const actual = await store.get(['existing']);
                const expected = ['first', 'second'];
                assert.deepEqual(actual, expected);
                break checkExisting;
            }
        });
    });

    describe('removeFromList', function () {
        it('Removes an item from a key, whether it exists or not', async function () {
            const store = new MemoryKvStore();

            checkNonExisting: {
                await removeFromList(store, ['not-existing'], 'first');
                const actual = await store.get(['not-existing']);
                const expected: never[] = [];
                assert.deepEqual(actual, expected);
                break checkNonExisting;
            }

            checkExisting: {
                await store.set(['existing'], ['first']);
                await removeFromList(store, ['existing'], 'first');
                const actual = await store.get(['existing']);
                const expected: never[] = [];
                assert.deepEqual(actual, expected);
                break checkExisting;
            }
        });
    });
});
