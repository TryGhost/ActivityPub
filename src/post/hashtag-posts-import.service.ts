import type { KvKey, KvStore } from '@fedify/fedify';
import {
    type Actor,
    Announce,
    isActor,
    lookupObject,
    Undo,
} from '@fedify/vocab';
import type { DocumentLoader } from '@fedify/vocab-runtime';
import type { Logger } from '@logtape/logtape';

import type { FedifyContextFactory } from '@/activitypub/fedify-context.factory';
import { getError, isError } from '@/core/result';
import type { PubSubEvents } from '@/events/pubsub';
import { getHashtagServiceHandle } from '@/post/hashtag';
import { HashtagPostsImportRequestedEvent } from '@/post/hashtag-posts-import-requested.event';
import type { PostService } from '@/post/post.service';

/**
 * Imports recent posts for a hashtag from a global hashtag service like
 * tags.pub, so that a hashtag's feed also shows posts that haven't reached
 * this server
 *
 * The service has one account per hashtag (`@ghost@tags.pub` for `#ghost`),
 * which boosts public posts with that hashtag. Its outbox lists those boosts,
 * newest first. The boosted posts are stored like any other remote post, and
 * so listed under their hashtags.
 */
export class HashtagPostsImportService {
    /**
     * How long to wait before importing a hashtag's posts again
     */
    private readonly importInterval = Temporal.Duration.from({ minutes: 15 });

    /**
     * Maximum number of posts to import at once. Every post takes a few
     * requests (boost, post and author), so this is kept small
     */
    private readonly importLimit = 10;

    /**
     * Maximum number of outbox pages to look through for posts. The first
     * page is the newest, and can hold only a few items
     */
    private readonly pageLimit = 2;

    constructor(
        private readonly hashtagServiceDomain: string | null,
        private readonly postService: PostService,
        private readonly fedifyContextFactory: FedifyContextFactory,
        private readonly kv: KvStore,
        private readonly logging: Logger,
        private readonly commandBus: PubSubEvents,
    ) {}

    init() {
        this.commandBus.on(
            HashtagPostsImportRequestedEvent.getName(),
            async (event: HashtagPostsImportRequestedEvent) =>
                await this.import(event.getHashtag()),
        );
    }

    /**
     * Request an import of recent posts for the hashtag, if a hashtag service
     * is configured
     *
     * @param host Host of the site requesting the import
     * @param hashtag Normalized hashtag name, without a leading `#`
     */
    async requestImport(host: string, hashtag: string) {
        if (this.hashtagServiceDomain === null) {
            return;
        }

        await this.commandBus.emitAsync(
            HashtagPostsImportRequestedEvent.getName(),
            new HashtagPostsImportRequestedEvent(hashtag),
            host,
        );
    }

    /**
     * Import recent posts for the hashtag, unless they were imported in the
     * last `importInterval`
     *
     * @param hashtag Normalized hashtag name, without a leading `#`
     */
    async import(hashtag: string) {
        if (this.hashtagServiceDomain === null) {
            return;
        }

        const handle = getHashtagServiceHandle(
            hashtag,
            this.hashtagServiceDomain,
        );

        if (handle === null) {
            return;
        }

        const importedKey: KvKey = ['hashtag-posts-imported', hashtag];

        if ((await this.kv.get(importedKey)) !== undefined) {
            return;
        }

        // Claim the import before it runs, so that requests made meanwhile
        // don't import the same posts again
        await this.kv.set(importedKey, true, { ttl: this.importInterval });

        const { documentLoader } = this.fedifyContextFactory.getFedifyContext();

        try {
            // The service's content is public, so it's fetched unsigned
            const actor = await lookupObject(handle, { documentLoader });

            if (!isActor(actor)) {
                this.logging.info(
                    'No account found for hashtag {hashtag} at {handle}',
                    { hashtag, handle },
                );

                return;
            }

            const postApIds = await this.getBoostedPostApIds(
                actor,
                documentLoader,
            );

            for (const postApId of postApIds) {
                let importError: unknown = null;

                // A post that can't be imported, e.g. because its author
                // can't be fetched, doesn't stop the others
                try {
                    const result = await this.postService.getByApId(postApId);

                    if (isError(result)) {
                        importError = getError(result);
                    }
                } catch (error) {
                    importError = error;
                }

                if (importError !== null) {
                    this.logging.info(
                        'Could not import post {postApId} for hashtag {hashtag}: {error}',
                        {
                            postApId: postApId.href,
                            hashtag,
                            error: importError,
                        },
                    );
                }
            }
        } catch (error) {
            this.logging.error(
                'Error importing posts for hashtag {hashtag} from {handle}: {error}',
                { hashtag, handle, error },
            );
        }
    }

    /**
     * Get the posts most recently boosted by the hashtag's account, newest
     * first
     */
    private async getBoostedPostApIds(
        actor: Actor,
        documentLoader: DocumentLoader,
    ): Promise<URL[]> {
        const postApIds: URL[] = [];

        // Boosts the service took back, e.g. because the post's author opted
        // out. The outbox is newest first, so the undo comes before the boost
        const undoneBoostIds = new Set<string>();

        const outbox = await actor.getOutbox({ documentLoader });
        let page = await outbox?.getFirst({ documentLoader });

        for (let pages = 1; page; pages++) {
            for await (const item of page.getItems({ documentLoader })) {
                if (item instanceof Undo && item.objectId) {
                    undoneBoostIds.add(item.objectId.href);
                    continue;
                }

                if (
                    !(item instanceof Announce) ||
                    !item.objectId ||
                    (item.id && undoneBoostIds.has(item.id.href))
                ) {
                    continue;
                }

                postApIds.push(item.objectId);

                if (postApIds.length >= this.importLimit) {
                    return postApIds;
                }
            }

            if (pages >= this.pageLimit) {
                break;
            }

            page = await page.getNext({ documentLoader });
        }

        return postApIds;
    }
}
