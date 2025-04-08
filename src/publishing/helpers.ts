import {
    FedifyActivitySender,
    FedifyActorResolver,
    FedifyKvStoreObjectStore,
    FedifyKvStoreOutbox,
    FedifyUriBuilder,
} from '../activitypub';
import { type AppContext, fedify } from '../app';
import { ContentPreparer } from './content';
import { FedifyPublishingService } from './service';
import type { Note, Post } from './types';

/**
 * Get an instance of the publishing service
 *
 * @param ctx App context instance
 */
function getFedifyPublishingService(ctx: AppContext) {
    const scopedDb = ctx.get('db');
    const globalDb = ctx.get('globaldb');
    const logger = ctx.get('logger');

    const fedifyCtx = fedify.createContext(ctx.req.raw, {
        db: scopedDb,
        globaldb: globalDb,
        logger,
    });

    return new FedifyPublishingService(
        new FedifyActivitySender(fedifyCtx),
        new FedifyActorResolver(fedifyCtx),
        new ContentPreparer(),
        logger,
        new FedifyKvStoreObjectStore(globalDb),
        new FedifyUriBuilder(fedifyCtx),
    );
}

/**
 * Publish a post to the Fediverse
 *
 * @param ctx App context instance
 * @param post Post to publish
 */
export async function publishPost(ctx: AppContext, post: Post) {
    const scopedDb = ctx.get('db');
    const publishingService = getFedifyPublishingService(ctx);
    const outbox = new FedifyKvStoreOutbox(scopedDb);

    return publishingService.publishPost(post, outbox);
}

/**
 * Publish a note to the Fediverse
 *
 * @param ctx App context instance
 * @param note Note to publish
 */
export async function publishNote(ctx: AppContext, note: Note) {
    const scopedDb = ctx.get('db');
    const publishingService = getFedifyPublishingService(ctx);
    const outbox = new FedifyKvStoreOutbox(scopedDb);

    return publishingService.publishNote(note, outbox);
}
