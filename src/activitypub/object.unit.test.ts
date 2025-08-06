import { describe, expect, it, vi } from 'vitest';

import type { Article, KvStore } from '@fedify/fedify';

import { FedifyKvStoreObjectStore } from '@/activitypub/object';

describe('FedifyKvStoreObjectStore', () => {
    describe('store', () => {
        it('should store an object', async () => {
            const mockArticleId = new URL(
                'https://example.com/article/abc-123',
            );
            const mockKvStore = {
                set: vi.fn(),
            } as unknown as KvStore;
            const mockArticleJsonLd = {
                id: mockArticleId,
                type: 'Article',
            };
            const mockArticle = {
                id: mockArticleId,
                toJsonLd: vi.fn().mockResolvedValue(mockArticleJsonLd),
            } as unknown as Article;

            const store = new FedifyKvStoreObjectStore(mockKvStore);

            await store.store(mockArticle);

            expect(mockKvStore.set).toHaveBeenCalledWith(
                [mockArticleId.href],
                mockArticleJsonLd,
            );
        });

        it('should throw an error if the object has no ID', async () => {
            const mockKvStore = {
                set: vi.fn(),
            } as unknown as KvStore;
            const mockArticle = {
                id: null,
                toJsonLd: vi.fn().mockResolvedValue({}),
            } as unknown as Article;

            const store = new FedifyKvStoreObjectStore(mockKvStore);

            await expect(store.store(mockArticle)).rejects.toThrow(
                'Object can not be stored without an ID',
            );
        });
    });
});
