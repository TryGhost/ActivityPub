import { describe, expect, it, vi } from 'vitest';

import { Article } from '@fedify/fedify';

import type { FedifyRequestContext } from '@/app';

import { FedifyUriBuilder } from '@/activitypub/uri';

type ArticleValues = {
    id: string;
};

describe('FedifyUriBuilder', () => {
    describe('buildObjectUri', () => {
        it('should build a URI for an object', async () => {
            const object = Article;
            const id = 'abc-123';
            const expectedUri = new URL(`https://example.com/article/${id}`);
            const mockFedifyCtx = {
                getObjectUri: vi
                    .fn()
                    .mockImplementation((objectCls, values: ArticleValues) => {
                        if (objectCls === object && values.id === id) {
                            return expectedUri;
                        }

                        return new URL(
                            'https://example.com/unexpected-object-uri',
                        );
                    }),
            } as unknown as FedifyRequestContext;

            const builder = new FedifyUriBuilder(mockFedifyCtx);

            const result = builder.buildObjectUri(object, id);

            expect(result).toEqual(expectedUri);
        });

        it('should build a URI for an actors followers collection', () => {
            const handle = 'foo';
            const expectedUri = new URL(
                `https://example.com/user/${handle}/followers`,
            );
            const mockFedifyCtx = {
                getFollowersUri: vi.fn().mockImplementation((value) => {
                    if (value === handle) {
                        return expectedUri;
                    }

                    return new URL(
                        'https://example.com/unexpected-followers-uri',
                    );
                }),
            } as unknown as FedifyRequestContext;

            const builder = new FedifyUriBuilder(mockFedifyCtx);

            const result = builder.buildFollowersCollectionUri(handle);

            expect(result).toEqual(expectedUri);
        });
    });
});
