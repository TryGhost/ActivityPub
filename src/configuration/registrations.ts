import type { Federation, KvStore } from '@fedify/fedify';
import type { Logger } from '@logtape/logtape';
import type { ContextData } from 'app';
import { type AwilixContainer, asClass, asFunction, asValue } from 'awilix';
import type { PubSubEvents } from 'events/pubsub';
import type { Knex } from 'knex';
import type { GCloudPubSubPushMessageQueue } from 'mq/gcloud-pubsub-push/mq';
import { LocalStorageAdapter } from 'storage/adapters/local-storage-adapter';
import { KnexAccountRepository } from '../account/account.repository.knex';
import { AccountService } from '../account/account.service';
import { CreateHandler } from '../activity-handlers/create.handler';
import { DeleteHandler } from '../activity-handlers/delete.handler';
import { FollowHandler } from '../activity-handlers/follow.handler';
import { FedifyContextFactory } from '../activitypub/fedify-context.factory';
import { FediverseBridge } from '../activitypub/fediverse-bridge';
import { FollowersService } from '../activitypub/followers.service';
import { DeleteDispatcher } from '../activitypub/object-dispatchers/delete.dispatcher';
import { AsyncEvents } from '../core/events';
import {
    actorDispatcher,
    createAcceptHandler,
    createAnnounceHandler,
    createFollowersCounter,
    createFollowersDispatcher,
    createFollowingCounter,
    createFollowingDispatcher,
    createLikeHandler,
    createUndoHandler,
    keypairDispatcher,
} from '../dispatchers';
import { createIncomingPubSubMessageHandler } from '../events/pubsub-http';
import { FeedUpdateService } from '../feed/feed-update.service';
import { FeedService } from '../feed/feed.service';
import { FlagService } from '../flag/flag.service';
import { getSiteDataHandler } from '../handlers';
import { getSiteSettings } from '../helpers/ghost';
import {
    createDeletePostHandler,
    createGetAccountFollowsHandler,
    createGetAccountHandler,
    createGetAccountLikedPostsHandler,
    createGetAccountPostsHandler,
    createGetFeedHandler,
    createGetPostHandler,
    createGetThreadHandler,
    createImageUploadHandler,
    createPostPublishedWebhookHandler,
    createSearchHandler,
    createUpdateAccountHandler,
} from '../http/api';
import { BlockController } from '../http/api/block';
import { createDerepostActionHandler } from '../http/api/derepost';
import { FollowController } from '../http/api/follow';
import { LikeController } from '../http/api/like';
import { NotificationController } from '../http/api/notification';
import { ReplyChainController } from '../http/api/reply-chain';
import { createRepostActionHandler } from '../http/api/repost';
import { AccountFollowsView } from '../http/api/views/account.follows.view';
import { AccountPostsView } from '../http/api/views/account.posts.view';
import { AccountView } from '../http/api/views/account.view';
import { BlocksView } from '../http/api/views/blocks.view';
import { ReplyChainView } from '../http/api/views/reply.chain.view';
import { createWebFingerHandler } from '../http/handler/webfinger';
import { ModerationService } from '../moderation/moderation.service';
import { NotificationEventService } from '../notification/notification-event.service';
import { NotificationService } from '../notification/notification.service';
import { PostInteractionCountsService } from '../post/post-interaction-counts.service';
import { KnexPostRepository } from '../post/post.repository.knex';
import { PostService } from '../post/post.service';
import { SiteService } from '../site/site.service';
import { GCPStorageAdapter } from '../storage/adapters/gcp-storage-adapter';
import { ImageProcessor } from '../storage/image-processor';
import { ImageStorageService } from '../storage/image-storage.service';

export function registerDependencies(
    container: AwilixContainer,
    deps: {
        knex: Knex;
        globalLogging: Logger;
        globalFedifyKv: KvStore;
        globalFedify: Federation<ContextData>;
        globalQueue?: GCloudPubSubPushMessageQueue;
        globalPubSubEvents?: PubSubEvents;
    },
) {
    container.register('logging', asValue(deps.globalLogging));
    container.register('client', asValue(deps.knex));
    container.register('db', asValue(deps.knex));
    container.register('fedifyKv', asValue(deps.globalFedifyKv));
    container.register('globalDb', asValue(deps.globalFedifyKv));

    container.register('events', asValue(new AsyncEvents()));

    container.register('flagService', asValue(new FlagService([])));

    container.register(
        'fedifyContextFactory',
        asClass(FedifyContextFactory).singleton(),
    );

    container.register(
        'storageAdapter',
        asFunction(() => {
            if (
                process.env.LOCAL_STORAGE_PATH &&
                process.env.LOCAL_STORAGE_HOSTING_URL
            ) {
                return new LocalStorageAdapter(
                    process.env.LOCAL_STORAGE_PATH,
                    new URL(process.env.LOCAL_STORAGE_HOSTING_URL),
                );
            }
            const bucketName = process.env.GCP_BUCKET_NAME || '';
            return new GCPStorageAdapter(
                bucketName,
                deps.globalLogging,
                process.env.GCP_STORAGE_EMULATOR_HOST ?? undefined,
            );
        }).singleton(),
    );

    container.register('imageProcessor', asClass(ImageProcessor).singleton());

    container.register(
        'imageStorageService',
        asClass(ImageStorageService).singleton(),
    );

    if (deps.globalQueue) {
        container.register('queue', asValue(deps.globalQueue));
    }

    if (deps.globalPubSubEvents) {
        container.register('commandBus', asValue(deps.globalPubSubEvents));
    } else {
        container.register('commandBus', asValue(new AsyncEvents()));
    }

    container.register('fedify', asValue(deps.globalFedify));

    container.register(
        'accountRepository',
        asClass(KnexAccountRepository).singleton(),
    );
    container.register(
        'postRepository',
        asClass(KnexPostRepository).singleton(),
    );
    container.register('accountService', asClass(AccountService).singleton());
    container.register('postService', asClass(PostService).singleton());
    container.register(
        'postInteractionCountsService',
        asClass(PostInteractionCountsService).singleton(),
    );
    container.register(
        'ghostService',
        asValue({
            getSiteSettings: getSiteSettings,
        }),
    );
    container.register('siteService', asClass(SiteService).singleton());
    container.register('feedService', asClass(FeedService).singleton());
    container.register('fediverseBridge', asClass(FediverseBridge).singleton());

    container.register(
        'followersService',
        asClass(FollowersService).singleton(),
    );
    container.register(
        'moderationService',
        asClass(ModerationService).singleton(),
    );
    container.register(
        'notificationService',
        asClass(NotificationService).singleton(),
    );
    container.register(
        'feedUpdateService',
        asClass(FeedUpdateService).singleton(),
    );
    container.register(
        'notificationEventService',
        asClass(NotificationEventService).singleton(),
    );

    container.register('accountView', asClass(AccountView).singleton());
    container.register(
        'accountFollowsView',
        asClass(AccountFollowsView).singleton(),
    );
    container.register(
        'accountPostsView',
        asClass(AccountPostsView).singleton(),
    );
    container.register('blocksView', asClass(BlocksView).singleton());
    container.register('replyChainView', asClass(ReplyChainView).singleton());

    container.register('blockController', asClass(BlockController).singleton());
    container.register(
        'followController',
        asClass(FollowController).singleton(),
    );
    container.register('likeController', asClass(LikeController).singleton());

    container.register('createHandler', asClass(CreateHandler).singleton());
    container.register('deleteHandler', asClass(DeleteHandler).singleton());
    container.register('followHandler', asClass(FollowHandler).singleton());
    container.register(
        'deleteDispatcher',
        asClass(DeleteDispatcher).singleton(),
    );

    container.register(
        'actorDispatcher',
        asFunction((siteService, accountService) =>
            actorDispatcher(siteService, accountService),
        ).singleton(),
    );

    container.register(
        'keypairDispatcher',
        asFunction((siteService, accountService) =>
            keypairDispatcher(siteService, accountService),
        ).singleton(),
    );

    container.register(
        'acceptHandler',
        asFunction((accountService) =>
            createAcceptHandler(accountService),
        ).singleton(),
    );

    container.register(
        'announceHandler',
        asFunction((siteService, accountService, postService, postRepository) =>
            createAnnounceHandler(
                siteService,
                accountService,
                postService,
                postRepository,
            ),
        ).singleton(),
    );

    container.register(
        'likeHandler',
        asFunction((accountService, postRepository, postService) =>
            createLikeHandler(accountService, postRepository, postService),
        ).singleton(),
    );

    container.register(
        'undoHandler',
        asFunction((accountService, postRepository, postService) =>
            createUndoHandler(accountService, postRepository, postService),
        ).singleton(),
    );

    container.register(
        'followersDispatcher',
        asFunction((siteService, accountRepository, followersService) =>
            createFollowersDispatcher(
                siteService,
                accountRepository,
                followersService,
            ),
        ).singleton(),
    );

    container.register(
        'followersCounter',
        asFunction((siteService, accountService) =>
            createFollowersCounter(siteService, accountService),
        ).singleton(),
    );

    container.register(
        'followingDispatcher',
        asFunction((siteService, accountService) =>
            createFollowingDispatcher(siteService, accountService),
        ).singleton(),
    );

    container.register(
        'followingCounter',
        asFunction((siteService, accountService) =>
            createFollowingCounter(siteService, accountService),
        ).singleton(),
    );

    container.register(
        'getSiteDataHandler',
        asFunction((siteService) =>
            getSiteDataHandler(siteService),
        ).singleton(),
    );

    container.register(
        'postPublishedWebhookHandler',
        asFunction((postService) =>
            createPostPublishedWebhookHandler(postService),
        ).singleton(),
    );

    container.register(
        'webFingerHandler',
        asFunction((accountRepository, siteService) =>
            createWebFingerHandler(accountRepository, siteService),
        ).singleton(),
    );

    container.register(
        'repostActionHandler',
        asFunction((postService) =>
            createRepostActionHandler(postService),
        ).singleton(),
    );

    container.register(
        'derepostActionHandler',
        asFunction((postService, postRepository) =>
            createDerepostActionHandler(postService, postRepository),
        ).singleton(),
    );

    container.register(
        'searchHandler',
        asFunction((accountView) =>
            createSearchHandler(accountView),
        ).singleton(),
    );

    container.register(
        'getThreadHandler',
        asFunction((postRepository, accountService) =>
            createGetThreadHandler(postRepository, accountService),
        ).singleton(),
    );

    container.register(
        'replyChainController',
        asClass(ReplyChainController).singleton(),
    );

    container.register(
        'getAccountHandler',
        asFunction((accountView, accountRepository) =>
            createGetAccountHandler(accountView, accountRepository),
        ).singleton(),
    );

    container.register(
        'updateAccountHandler',
        asFunction((accountService) =>
            createUpdateAccountHandler(accountService),
        ).singleton(),
    );

    container.register(
        'getAccountPostsHandler',
        asFunction(
            (accountRepository, accountPostsView, fedifyContextFactory) =>
                createGetAccountPostsHandler(
                    accountRepository,
                    accountPostsView,
                    fedifyContextFactory,
                ),
        ).singleton(),
    );

    container.register(
        'getAccountLikedPostsHandler',
        asFunction((accountService, accountPostsView) =>
            createGetAccountLikedPostsHandler(accountService, accountPostsView),
        ).singleton(),
    );

    container.register(
        'getAccountFollowsHandler',
        asFunction(
            (accountRepository, accountFollowsView, fedifyContextFactory) =>
                createGetAccountFollowsHandler(
                    accountRepository,
                    accountFollowsView,
                    fedifyContextFactory,
                ),
        ).singleton(),
    );

    container.register(
        'getFeedHandler',
        asFunction(
            (feedService, accountService, postInteractionCountsService) =>
                (feedType: 'Feed' | 'Inbox') =>
                    createGetFeedHandler(
                        feedService,
                        accountService,
                        postInteractionCountsService,
                        feedType,
                    ),
        ).singleton(),
    );

    container.register(
        'getPostHandler',
        asFunction((postService, accountService) =>
            createGetPostHandler(postService, accountService),
        ).singleton(),
    );

    container.register(
        'notificationController',
        asClass(NotificationController).singleton(),
    );

    container.register(
        'imageUploadHandler',
        asFunction(createImageUploadHandler).singleton(),
    );

    container.register(
        'deletePostHandler',
        asFunction((accountRepository, postRepository, postService) =>
            createDeletePostHandler(
                accountRepository,
                postRepository,
                postService,
            ),
        ).singleton(),
    );

    container.register(
        'pubSubMessageHandler',
        asFunction((commandBus, fedify, fedifyContextFactory) => {
            return createIncomingPubSubMessageHandler(
                commandBus,
                fedify,
                fedifyContextFactory,
            );
        }).singleton(),
    );
}
