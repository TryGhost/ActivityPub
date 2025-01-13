import {
    FedifyActivitySender,
    FedifyActorResolver,
    FedifyKvStoreObjectStore,
    FedifyKvStoreOutbox,
    FedifyUriBuilder,
} from '../activitypub';
import { type AppContext, fedify } from '../app';
import { FedifyPublishingService } from './service';
import type { Post } from './types';

/**
 * Publish a post to the Fediverse
 *
 * @param ctx App context instance
 * @param post Post to publish
 */
export async function publishPost(ctx: AppContext, post: Post) {
    const scopedDb = ctx.get('db');
    const globalDb = ctx.get('globaldb');
    const logger = ctx.get('logger');

    const fedifyCtx = fedify.createContext(ctx.req.raw, {
        db: scopedDb,
        globaldb: globalDb,
        logger: ctx.get('logger'),
    });

    const publishingService = new FedifyPublishingService(
        new FedifyActivitySender(fedifyCtx),
        new FedifyActorResolver(fedifyCtx),
        logger,
        new FedifyKvStoreObjectStore(globalDb),
        new FedifyUriBuilder(fedifyCtx),
    );

    const outbox = new FedifyKvStoreOutbox(scopedDb);

    await publishingService.publishPost(post, outbox);
}
