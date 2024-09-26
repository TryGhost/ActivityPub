import { describe, expect, it } from 'vitest';

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
                const expected = undefined;
                expect(actual).toEqual(expected);
                break checkIsScoped;
            }

            checkIsSet: {
                const actual = await scopedStore.get(['key']);
                const expected = { value: 'da value' };
                expect(actual).toEqual(expected);
            }

            checkDeletes: {
                await scopedStore.delete(['key']);
                const actual = await scopedStore.get(['key']);
                const expected = undefined;
                expect(actual).toEqual(expected);
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
                expect(actual).toEqual(expected);
            }

            checkExisting: {
                await store.set(['existing'], ['first']);
                await addToList(store, ['existing'], 'second');
                const actual = await store.get(['existing']);
                const expected = ['first', 'second'];
                expect(actual).toEqual(expected);
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
                expect(actual).toEqual(expected);
            }

            checkExisting: {
                await store.set(['existing'], ['first']);
                await removeFromList(store, ['existing'], 'first');
                const actual = await store.get(['existing']);
                const expected: never[] = [];
                expect(actual).toEqual(expected);
            }
        });
    });
});
