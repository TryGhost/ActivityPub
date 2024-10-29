import { describe, expect, it } from 'vitest';

import { MemoryKvStore } from '@fedify/fedify';
import { addToList, removeFromList, scopeKvStore } from './kv-helpers';

describe('Kv Helpers', () => {
    describe('scopeKvStore', () => {
        it('Returns a scoped KvStore', async () => {
            const store = new MemoryKvStore();
            const scopedStore = scopeKvStore(store, ['scoped']);

            await scopedStore.set(['key'], { value: 'da value' });

            // checkIsScoped
            {
                const actual = await store.get(['key']);
                const expected = undefined;
                expect(actual).toEqual(expected);
            }

            {
                const actual = await scopedStore.get(['key']);
                const expected = { value: 'da value' };
                expect(actual).toEqual(expected);
            }

            {
                await scopedStore.delete(['key']);
                const actual = await scopedStore.get(['key']);
                const expected = undefined;
                expect(actual).toEqual(expected);
            }
        });
    });

    describe('addToList', () => {
        it('Appends items to a key, whether it exists or not', async () => {
            const store = new MemoryKvStore();

            {
                await addToList(store, ['not-existing'], 'first');
                const actual = await store.get(['not-existing']);
                const expected = ['first'];
                expect(actual).toEqual(expected);
            }

            {
                await store.set(['existing'], ['first']);
                await addToList(store, ['existing'], 'second');
                const actual = await store.get(['existing']);
                const expected = ['first', 'second'];
                expect(actual).toEqual(expected);
            }
        });
    });

    describe('removeFromList', () => {
        it('Removes an item from a key, whether it exists or not', async () => {
            const store = new MemoryKvStore();

            {
                await removeFromList(store, ['not-existing'], 'first');
                const actual = await store.get(['not-existing']);
                const expected: never[] = [];
                expect(actual).toEqual(expected);
            }

            {
                await store.set(['existing'], ['first']);
                await removeFromList(store, ['existing'], 'first');
                const actual = await store.get(['existing']);
                const expected: never[] = [];
                expect(actual).toEqual(expected);
            }
        });
    });
});
