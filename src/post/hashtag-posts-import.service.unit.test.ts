import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MemoryKvStore } from '@fedify/fedify';
import {
    Announce,
    Like,
    lookupObject,
    OrderedCollection,
    OrderedCollectionPage,
    Person,
    Undo,
} from '@fedify/vocab';
import type { Logger } from '@logtape/logtape';

import type { FedifyContextFactory } from '@/activitypub/fedify-context.factory';
import { error, ok } from '@/core/result';
import type { PubSubEvents } from '@/events/pubsub';
import { HashtagPostsImportService } from '@/post/hashtag-posts-import.service';
import { HashtagPostsImportRequestedEvent } from '@/post/hashtag-posts-import-requested.event';
import type { Post } from '@/post/post.entity';
import type { PostService } from '@/post/post.service';

vi.mock('@fedify/vocab', async (importOriginal) => {
    const original = await importOriginal<typeof import('@fedify/vocab')>();

    return {
        ...original,
        lookupObject: vi.fn(),
    };
});

/**
 * Get the hashtag's account, with an outbox holding the given pages of
 * items, newest first
 */
function getHashtagAccount(...pages: (Announce | Like | Undo)[][]) {
    const first = pages.reduceRight<OrderedCollectionPage | null>(
        (next, items, index) =>
            new OrderedCollectionPage({
                id: new URL(`https://tags.pub/user/ghost/outbox/${index}`),
                items,
                next,
            }),
        null,
    );

    return new Person({
        id: new URL('https://tags.pub/user/ghost'),
        outbox: new OrderedCollection({
            id: new URL('https://tags.pub/user/ghost/outbox'),
            first,
        }),
    });
}

function getBoost(index: number) {
    return new Announce({
        id: new URL(`https://tags.pub/user/ghost/announce/${index}`),
        object: new URL(`https://mastodon.example/statuses/${index}`),
    });
}

describe('HashtagPostsImportService', () => {
    let postService: PostService;
    let fedifyContextFactory: FedifyContextFactory;
    let kv: MemoryKvStore;
    let logging: Logger;
    let commandBus: PubSubEvents;

    const getService = (hashtagServiceDomain: string | null) =>
        new HashtagPostsImportService(
            hashtagServiceDomain,
            postService,
            fedifyContextFactory,
            kv,
            logging,
            commandBus,
        );

    beforeEach(() => {
        vi.mocked(lookupObject).mockReset();

        postService = {
            getByApId: vi.fn().mockResolvedValue(ok({} as Post)),
        } as unknown as PostService;

        fedifyContextFactory = {
            getFedifyContext: () => ({ documentLoader: vi.fn() }),
        } as unknown as FedifyContextFactory;

        kv = new MemoryKvStore();

        logging = {
            info: vi.fn(),
            error: vi.fn(),
        } as unknown as Logger;

        commandBus = {
            on: vi.fn(),
            emitAsync: vi.fn().mockResolvedValue(undefined),
        } as unknown as PubSubEvents;
    });

    describe('requestImport', () => {
        it('should request the import for the site', async () => {
            await getService('tags.pub').requestImport('example.com', 'ghost');

            expect(commandBus.emitAsync).toHaveBeenCalledWith(
                HashtagPostsImportRequestedEvent.getName(),
                new HashtagPostsImportRequestedEvent('ghost'),
                'example.com',
            );
        });

        it('should not request the import without a hashtag service', async () => {
            await getService(null).requestImport('example.com', 'ghost');

            expect(commandBus.emitAsync).not.toHaveBeenCalled();
        });
    });

    describe('import', () => {
        it("should import the posts boosted by the hashtag's account", async () => {
            vi.mocked(lookupObject).mockResolvedValue(
                getHashtagAccount([getBoost(1), getBoost(2)]),
            );

            await getService('tags.pub').import('ghost');

            expect(lookupObject).toHaveBeenCalledWith(
                '@ghost@tags.pub',
                expect.anything(),
            );
            expect(
                vi
                    .mocked(postService.getByApId)
                    .mock.calls.map(([apId]) => apId.href),
            ).toEqual([
                'https://mastodon.example/statuses/1',
                'https://mastodon.example/statuses/2',
            ]);
        });

        it('should import at most 10 of the newest posts', async () => {
            vi.mocked(lookupObject).mockResolvedValue(
                getHashtagAccount(
                    Array.from({ length: 12 }, (_, index) => getBoost(index)),
                ),
            );

            await getService('tags.pub').import('ghost');

            expect(postService.getByApId).toHaveBeenCalledTimes(10);
            expect(vi.mocked(postService.getByApId).mock.calls[9][0].href).toBe(
                'https://mastodon.example/statuses/9',
            );
        });

        it('should skip activities other than boosts', async () => {
            vi.mocked(lookupObject).mockResolvedValue(
                getHashtagAccount([
                    new Like({
                        id: new URL('https://tags.pub/user/ghost/like/1'),
                        object: new URL('https://mastodon.example/statuses/1'),
                    }),
                    getBoost(2),
                ]),
            );

            await getService('tags.pub').import('ghost');

            expect(postService.getByApId).toHaveBeenCalledTimes(1);
            expect(vi.mocked(postService.getByApId).mock.calls[0][0].href).toBe(
                'https://mastodon.example/statuses/2',
            );
        });

        it('should skip boosts the service took back', async () => {
            vi.mocked(lookupObject).mockResolvedValue(
                getHashtagAccount([
                    new Undo({
                        id: new URL('https://tags.pub/user/ghost/undo/1'),
                        object: new URL(
                            'https://tags.pub/user/ghost/announce/1',
                        ),
                    }),
                    getBoost(2),
                    getBoost(1),
                ]),
            );

            await getService('tags.pub').import('ghost');

            expect(
                vi
                    .mocked(postService.getByApId)
                    .mock.calls.map(([apId]) => apId.href),
            ).toEqual(['https://mastodon.example/statuses/2']);
        });

        it('should look through the next page when the newest page holds few posts', async () => {
            vi.mocked(lookupObject).mockResolvedValue(
                getHashtagAccount([getBoost(1)], [getBoost(2), getBoost(3)]),
            );

            await getService('tags.pub').import('ghost');

            expect(postService.getByApId).toHaveBeenCalledTimes(3);
        });

        it('should look through at most 2 pages, without fetching the next one', async () => {
            const documentLoader = vi.fn();
            fedifyContextFactory = {
                getFedifyContext: () => ({ documentLoader }),
            } as unknown as FedifyContextFactory;

            vi.mocked(lookupObject).mockResolvedValue(
                new Person({
                    id: new URL('https://tags.pub/user/ghost'),
                    outbox: new OrderedCollection({
                        id: new URL('https://tags.pub/user/ghost/outbox'),
                        first: new OrderedCollectionPage({
                            id: new URL('https://tags.pub/user/ghost/outbox/0'),
                            items: [getBoost(1)],
                            next: new OrderedCollectionPage({
                                id: new URL(
                                    'https://tags.pub/user/ghost/outbox/1',
                                ),
                                items: [getBoost(2)],
                                next: new URL(
                                    'https://tags.pub/user/ghost/outbox/2',
                                ),
                            }),
                        }),
                    }),
                }),
            );

            await getService('tags.pub').import('ghost');

            expect(documentLoader).not.toHaveBeenCalled();
            expect(
                vi
                    .mocked(postService.getByApId)
                    .mock.calls.map(([apId]) => apId.href),
            ).toEqual([
                'https://mastodon.example/statuses/1',
                'https://mastodon.example/statuses/2',
            ]);
        });

        it('should continue after posts that cannot be imported', async () => {
            vi.mocked(lookupObject).mockResolvedValue(
                getHashtagAccount([getBoost(1), getBoost(2), getBoost(3)]),
            );
            vi.mocked(postService.getByApId)
                .mockResolvedValueOnce(error('upstream-error'))
                .mockRejectedValueOnce(new Error('Could not find Actor'));

            await getService('tags.pub').import('ghost');

            expect(postService.getByApId).toHaveBeenCalledTimes(3);
        });

        it('should not import a hashtag again within 15 minutes', async () => {
            vi.mocked(lookupObject).mockResolvedValue(
                getHashtagAccount([getBoost(1)]),
            );
            const service = getService('tags.pub');

            await service.import('ghost');
            await service.import('ghost');
            await service.import('fediverse');

            expect(lookupObject).toHaveBeenCalledTimes(2);
        });

        it('should not import a hashtag the service would fold into another', async () => {
            await getService('tags.pub').import('open_web');

            expect(lookupObject).not.toHaveBeenCalled();
        });

        it('should not import without a hashtag service', async () => {
            await getService(null).import('ghost');

            expect(lookupObject).not.toHaveBeenCalled();
        });
    });
});
