import { createFederation, type KvStore } from '@fedify/fedify';
import type { PubSub } from '@google-cloud/pubsub';
import { getLogger, type Logger } from '@logtape/logtape';
import {
    type AwilixContainer,
    aliasTo,
    asClass,
    asFunction,
    asValue,
} from 'awilix';
import Redis from 'ioredis';
import type { Knex } from 'knex';

import { KnexAccountRepository } from '@/account/account.repository.knex';
import { AccountService } from '@/account/account.service';
import { CreateHandler } from '@/activity-handlers/create.handler';
import { DeleteHandler } from '@/activity-handlers/delete.handler';
import { FollowHandler } from '@/activity-handlers/follow.handler';
import { UpdateHandler } from '@/activity-handlers/update.handler';
import { FedifyContextFactory } from '@/activitypub/fedify-context.factory';
import { FediverseBridge } from '@/activitypub/fediverse-bridge';
import { FollowersService } from '@/activitypub/followers.service';
import { DeleteDispatcher } from '@/activitypub/object-dispatchers/delete.dispatcher';
import type { ContextData } from '@/app';
import { AsyncEvents } from '@/core/events';
import {
    actorDispatcher,
    createAcceptHandler,
    createAnnounceHandler,
    createFollowersCounter,
    createFollowersDispatcher,
    createFollowingCounter,
    createFollowingDispatcher,
    createLikeHandler,
    createOutboxCounter,
    createOutboxDispatcher,
    createUndoHandler,
    keypairDispatcher,
} from '@/dispatchers';
import { EventSerializer } from '@/events/event';
import { PubSubEvents } from '@/events/pubsub';
import { createIncomingPubSubMessageHandler } from '@/events/pubsub-http';
import { GhostExploreService } from '@/explore/ghost-explore.service';
import { FeedService } from '@/feed/feed.service';
import { FeedUpdateService } from '@/feed/feed-update.service';
import { FlagService } from '@/flag/flag.service';
import { GhostPostService } from '@/ghost/ghost-post.service';
import { getSiteSettings } from '@/helpers/ghost';
import { AccountController } from '@/http/api/account.controller';
import { BlockController } from '@/http/api/block.controller';
import { BlueskyController } from '@/http/api/bluesky.controller';
import { ClientConfigController } from '@/http/api/client-config.controller';
import { FeedController } from '@/http/api/feed.controller';
import { FollowController } from '@/http/api/follow.controller';
import { LikeController } from '@/http/api/like.controller';
import { MediaController } from '@/http/api/media.controller';
import { NotificationController } from '@/http/api/notification.controller';
import { PostController } from '@/http/api/post.controller';
import { ReplyChainController } from '@/http/api/reply-chain.controller';
import { SearchController } from '@/http/api/search.controller';
import { SiteController } from '@/http/api/site.controller';
import { AccountFollowsView } from '@/http/api/views/account.follows.view';
import { AccountPostsView } from '@/http/api/views/account.posts.view';
import { AccountView } from '@/http/api/views/account.view';
import { BlocksView } from '@/http/api/views/blocks.view';
import { ReplyChainView } from '@/http/api/views/reply.chain.view';
import { WebFingerController } from '@/http/api/webfinger.controller';
import { WebhookController } from '@/http/api/webhook.controller';
import { BlueskyService } from '@/integration/bluesky.service';
import { KnexKvStore } from '@/knex.kvstore';
import { ModerationService } from '@/moderation/moderation.service';
import { GCloudPubSubPushMessageQueue } from '@/mq/gcloud-pubsub-push/mq';
import { NotificationService } from '@/notification/notification.service';
import { NotificationEventService } from '@/notification/notification-event.service';
import { KnexPostRepository } from '@/post/post.repository.knex';
import { PostService } from '@/post/post.service';
import { PostInteractionCountsService } from '@/post/post-interaction-counts.service';
import { getFullTopic, initPubSubClient } from '@/pubsub';
import { RedisKvStore } from '@/redis.kvstore';
import { SiteService } from '@/site/site.service';
import { GCPStorageAdapter } from '@/storage/adapters/gcp-storage-adapter';
import { LocalStorageAdapter } from '@/storage/adapters/local-storage-adapter';
import { ImageProcessor } from '@/storage/image-processor';
import { ImageStorageService } from '@/storage/image-storage.service';

export function registerDependencies(
    container: AwilixContainer,
    deps: {
        knex: Knex;
    },
) {
    container.register({
        logging: asFunction(() => {
            return getLogger(['activitypub']);
        }).singleton(),
        logger: aliasTo('logging'),
    });

    container.register('client', asValue(deps.knex));
    container.register('db', asValue(deps.knex));

    container.register({
        fedifyKv: asFunction((db: Knex, logging: Logger) => {
            const kvStoreType = process.env.FEDIFY_KV_STORE_TYPE || 'mysql';

            if (kvStoreType === 'redis') {
                logging.info('Using Redis KvStore for Fedify');
                const host = process.env.REDIS_HOST || 'localhost';
                const port = Number(process.env.REDIS_PORT) || 6379;

                const redis = new Redis.Cluster(
                    [
                        {
                            host,
                            port,
                        },
                    ],
                    {
                        clusterRetryStrategy: (times: number) => {
                            const delay = Math.min(times * 50, 2000);
                            logging.warn(
                                `Redis connection retry attempt ${times}, delay ${delay}ms`,
                            );
                            return delay;
                        },
                        enableOfflineQueue: true,
                        redisOptions: {
                            maxRetriesPerRequest: 3,
                            enableReadyCheck: true,
                            tls: process.env.REDIS_TLS_CERT
                                ? {
                                      ca: process.env.REDIS_TLS_CERT,
                                  }
                                : undefined,
                        },
                    },
                );

                return new RedisKvStore(redis);
            }

            logging.info('Using MySQL KvStore for Fedify');

            return KnexKvStore.create(db, 'key_value', logging);
        }).singleton(),
        kv: asFunction((db: Knex, logging: Logger) => {
            return KnexKvStore.create(db, 'key_value', logging);
        }).singleton(),
    });

    container.register('events', asValue(new AsyncEvents()));

    container.register('eventSerializer', asClass(EventSerializer).singleton());

    container.register(
        'pubSubClient',
        asFunction(() => {
            return initPubSubClient({
                host: process.env.MQ_PUBSUB_HOST || 'unknown_pubsub_host',
                isEmulator: !['staging', 'production'].includes(
                    process.env.NODE_ENV || 'unknown_node_env',
                ),
                projectId:
                    process.env.MQ_PUBSUB_PROJECT_ID || 'unknown_project_id',
            });
        }).singleton(),
    );

    container.register(
        'pubSubEvents',
        asFunction(
            (
                pubSubClient: PubSub,
                eventSerializer: EventSerializer,
                logging: Logger,
            ) => {
                return new PubSubEvents(
                    pubSubClient,
                    getFullTopic(
                        pubSubClient.projectId,
                        process.env.MQ_PUBSUB_GHOST_TOPIC_NAME ||
                            'unknown_pubsub_ghost_topic_name',
                    ),
                    eventSerializer,
                    logging,
                );
            },
        ).singleton(),
    );

    if (process.env.USE_MQ === 'true') {
        container.register('commandBus', aliasTo('pubSubEvents'));
    } else {
        container.register('commandBus', asValue(new AsyncEvents()));
    }

    container.register(
        'queue',
        asFunction(
            (
                logging: Logger,
                pubSubClient: PubSub,
                accountService: AccountService,
            ) => {
                return new GCloudPubSubPushMessageQueue(
                    logging,
                    pubSubClient,
                    accountService,
                    getFullTopic(
                        pubSubClient.projectId,
                        process.env.MQ_PUBSUB_TOPIC_NAME ||
                            'unknown_pubsub_topic_name',
                    ),
                    process.env.MQ_PUBSUB_USE_RETRY_TOPIC === 'true',
                    getFullTopic(
                        pubSubClient.projectId,
                        process.env.MQ_PUBSUB_RETRY_TOPIC_NAME ||
                            'unknown_pubsub_retry_topic_name',
                    ),
                    Number(process.env.MQ_PUBSUB_MAX_DELIVERY_ATTEMPTS) ||
                        Number.POSITIVE_INFINITY,
                );
            },
        ).singleton(),
    );

    container.register('flagService', asValue(new FlagService([])));

    container.register(
        'fedify',
        asFunction((fedifyKv: KvStore, queue: GCloudPubSubPushMessageQueue) => {
            return createFederation<ContextData>({
                kv: fedifyKv,
                queue: process.env.USE_MQ === 'true' ? queue : undefined,
                manuallyStartQueue: process.env.MANUALLY_START_QUEUE === 'true',
                skipSignatureVerification:
                    process.env.SKIP_SIGNATURE_VERIFICATION === 'true' &&
                    ['development', 'testing'].includes(
                        process.env.NODE_ENV || '',
                    ),
                allowPrivateAddress:
                    process.env.ALLOW_PRIVATE_ADDRESS === 'true' &&
                    ['development', 'testing'].includes(
                        process.env.NODE_ENV || '',
                    ),
                firstKnock: 'draft-cavage-http-signatures-12',
            });
        }).singleton(),
    );

    container.register(
        'fedifyContextFactory',
        asClass(FedifyContextFactory).singleton(),
    );

    container.register(
        'storageAdapter',
        asFunction((logging: Logger) => {
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
                logging,
                process.env.GCP_STORAGE_EMULATOR_HOST ?? undefined,
                process.env.GCS_LOCAL_STORAGE_HOSTING_URL ?? undefined,
            );
        }).singleton(),
    );

    container.register('imageProcessor', asClass(ImageProcessor).singleton());

    container.register(
        'imageStorageService',
        asClass(ImageStorageService).singleton(),
    );

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
        'ghostPostService',
        asClass(GhostPostService).singleton(),
    );
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
    container.register(
        'ghostExploreService',
        asClass(GhostExploreService).singleton(),
    );
    container.register('blueskyService', asClass(BlueskyService).singleton());

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
    container.register('updateHandler', asClass(UpdateHandler).singleton());
    container.register(
        'deleteDispatcher',
        asClass(DeleteDispatcher).singleton(),
    );

    container.register(
        'actorDispatcher',
        asFunction(actorDispatcher).singleton(),
    );

    container.register(
        'keypairDispatcher',
        asFunction(keypairDispatcher).singleton(),
    );

    container.register(
        'acceptHandler',
        asFunction(createAcceptHandler).singleton(),
    );

    container.register(
        'announceHandler',
        asFunction(createAnnounceHandler).singleton(),
    );

    container.register(
        'outboxDispatcher',
        asFunction(createOutboxDispatcher).singleton(),
    );

    container.register(
        'outboxCounter',
        asFunction(createOutboxCounter).singleton(),
    );

    container.register(
        'likeHandler',
        asFunction(createLikeHandler).singleton(),
    );

    container.register(
        'undoHandler',
        asFunction(createUndoHandler).singleton(),
    );

    container.register(
        'followersDispatcher',
        asFunction(createFollowersDispatcher).singleton(),
    );

    container.register(
        'followersCounter',
        asFunction(createFollowersCounter).singleton(),
    );

    container.register(
        'followingDispatcher',
        asFunction(createFollowingDispatcher).singleton(),
    );

    container.register(
        'followingCounter',
        asFunction(createFollowingCounter).singleton(),
    );

    container.register(
        'siteController',
        asFunction((siteService: SiteService) => {
            let ghostProIpAddresses: string[] | undefined;

            if (process.env.GHOST_PRO_IP_ADDRESSES) {
                ghostProIpAddresses = process.env.GHOST_PRO_IP_ADDRESSES.split(
                    ',',
                ).map((ip) => ip.trim());
            }

            return new SiteController(siteService, ghostProIpAddresses);
        }).singleton(),
    );

    container.register(
        'webhookController',
        asClass(WebhookController).singleton(),
    );

    container.register(
        'webFingerController',
        asClass(WebFingerController).singleton(),
    );

    container.register(
        'searchController',
        asClass(SearchController).singleton(),
    );

    container.register(
        'replyChainController',
        asClass(ReplyChainController).singleton(),
    );

    container.register('feedController', asClass(FeedController).singleton());
    container.register('mediaController', asClass(MediaController).singleton());

    container.register(
        'notificationController',
        asClass(NotificationController).singleton(),
    );

    container.register(
        'clientConfigController',
        asClass(ClientConfigController).singleton(),
    );

    container.register(
        'pubSubMessageHandler',
        asFunction(createIncomingPubSubMessageHandler).singleton(),
    );

    container.register(
        'accountController',
        asClass(AccountController).singleton(),
    );

    container.register('postController', asClass(PostController).singleton());

    container.register(
        'blueskyController',
        asClass(BlueskyController).singleton(),
    );
}
