import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac } from 'node:crypto';
import {
    Accept,
    Announce,
    Article,
    type Context,
    Create,
    Delete,
    Follow,
    type KvStore,
    Like,
    Note,
    Reject,
    type RequestContext,
    Undo,
    Update,
    createFederation,
} from '@fedify/fedify';
import { federation } from '@fedify/fedify/x/hono';
import { serve } from '@hono/node-server';
import {
    type LogLevel,
    type LogRecord,
    type Logger,
    configure,
    getAnsiColorFormatter,
    getConsoleSink,
    getLogger,
    isLogLevel,
    withContext,
} from '@logtape/logtape';
import * as Sentry from '@sentry/node';
import type { Account } from 'account/account.entity';
import { KnexAccountRepository } from 'account/account.repository.knex';
import { CreateHandler } from 'activity-handlers/create.handler';
import { FollowHandler } from 'activity-handlers/follow.handler';
import { FollowersService } from 'activitypub/followers.service';
import { DeleteDispatcher } from 'activitypub/object-dispatchers/delete.dispatcher';
import { asClass, asFunction, asValue, createContainer } from 'awilix';
import { AsyncEvents } from 'core/events';
import { get } from 'es-toolkit/compat';
import { EventSerializer } from 'events/event';
import { PubSubEvents } from 'events/pubsub';
import { createIncomingPubSubMessageHandler } from 'events/pubsub-http';
import { Hono, type Context as HonoContext, type Next } from 'hono';
import { cors } from 'hono/cors';
import { BlockController } from 'http/api/block';
import { createDerepostActionHandler } from 'http/api/derepost';
import { FollowController } from 'http/api/follow';
import { BadRequest } from 'http/api/helpers/response';
import { LikeController } from 'http/api/like';
import { NotificationController } from 'http/api/notification';
import { handleCreateReply } from 'http/api/reply';
import { ReplyChainController } from 'http/api/reply-chain';
import { createRepostActionHandler } from 'http/api/repost';
import { ReplyChainView } from 'http/api/views/reply.chain.view';
import jwt from 'jsonwebtoken';
import { ModerationService } from 'moderation/moderation.service';
import jose from 'node-jose';
import { NotificationEventService } from 'notification/notification-event.service';
import { NotificationService } from 'notification/notification.service';
import { PostInteractionCountsService } from 'post/post-interaction-counts.service';
import { KnexPostRepository } from 'post/post.repository.knex';
import { ImageStorageService } from 'storage/image-storage.service';
import { behindProxy } from 'x-forwarded-fetch';
import { AccountService } from './account/account.service';
import { dispatchRejectActivity } from './activity-dispatchers/reject.dispatcher';
import { DeleteHandler } from './activity-handlers/delete.handler';
import { FedifyContextFactory } from './activitypub/fedify-context.factory';
import { FediverseBridge } from './activitypub/fediverse-bridge';
import { knex } from './db';
import {
    acceptDispatcher,
    actorDispatcher,
    announceDispatcher,
    articleDispatcher,
    createAcceptHandler,
    createAnnounceHandler,
    createDispatcher,
    createFollowersCounter,
    createFollowersDispatcher,
    createFollowingCounter,
    createFollowingDispatcher,
    createLikeHandler,
    createUndoHandler,
    followDispatcher,
    followingFirstCursor,
    inboxErrorHandler,
    keypairDispatcher,
    likeDispatcher,
    likedCounter,
    likedDispatcher,
    likedFirstCursor,
    nodeInfoDispatcher,
    noteDispatcher,
    outboxCounter,
    outboxDispatcher,
    outboxFirstCursor,
    undoDispatcher,
    updateDispatcher,
} from './dispatchers';
import { FeedUpdateService } from './feed/feed-update.service';
import { FeedService } from './feed/feed.service';
import { FlagService } from './flag/flag.service';
import { getSiteDataHandler } from './handlers';
import { getTraceContext } from './helpers/context-header';
import { getSiteSettings } from './helpers/ghost';
import { getRequestData } from './helpers/request-data';
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
    handleCreateNote,
} from './http/api';
import { AccountFollowsView } from './http/api/views/account.follows.view';
import { AccountPostsView } from './http/api/views/account.posts.view';
import { AccountView } from './http/api/views/account.view';
import { BlocksView } from './http/api/views/blocks.view';
import { createWebFingerHandler } from './http/handler/webfinger';
import { setupInstrumentation, spanWrapper } from './instrumentation';
import { KnexKvStore } from './knex.kvstore';
import {
    GCloudPubSubPushMessageQueue,
    createPushMessageHandler,
} from './mq/gcloud-pubsub-push/mq';
import { PostInteractionCountsUpdateRequestedEvent } from './post/post-interaction-counts-update-requested.event';
import { PostService } from './post/post.service';
import { getFullTopic, initPubSubClient } from './pubsub';
import { type Site, SiteService } from './site/site.service';
import { GCPStorageAdapter } from './storage/adapters/gcp-storage-adapter';
import { GCPStorageService } from './storage/gcloud-storage/gcp-storage.service';
import { ImageProcessor } from './storage/image-processor';

const container = createContainer({
    injectionMode: 'CLASSIC',
    strict: true,
});

await setupInstrumentation();

function toLogLevel(level: unknown): LogLevel | null {
    if (typeof level !== 'string') {
        return null;
    }
    if (isLogLevel(level)) {
        return level;
    }
    return null;
}

await configure({
    contextLocalStorage: new AsyncLocalStorage(),
    sinks: {
        console: getConsoleSink({
            formatter: process.env.K_SERVICE
                ? (record: LogRecord) => {
                      const loggingObject = {
                          timestamp: new Date(record.timestamp).toISOString(),
                          severity: record.level.toUpperCase(),
                          message: record.message.join(''),
                          ...record.properties,
                      };

                      return JSON.stringify(loggingObject);
                  }
                : getAnsiColorFormatter({
                      timestamp: 'time',
                  }),
        }),
    },
    filters: {},
    loggers: [
        {
            category: 'activitypub',
            sinks: ['console'],
            level:
                toLogLevel(process.env.LOG_LEVEL_ACTIVITYPUB) ||
                toLogLevel(process.env.LOG_LEVEL) ||
                'info',
        },
        {
            category: 'fedify',
            sinks: ['console'],
            level:
                toLogLevel(process.env.LOG_LEVEL_FEDIFY) ||
                toLogLevel(process.env.LOG_LEVEL) ||
                'warning',
        },
    ],
});

export type ContextData = {
    globaldb: KvStore;
    logger: Logger;
};

const globalLogging = getLogger(['activitypub']);
export const globalFedifyKv = await KnexKvStore.create(knex, 'key_value');

container.register('logging', asValue(globalLogging));
container.register('client', asValue(knex));
container.register('db', asValue(knex));
container.register('fedifyKv', asValue(globalFedifyKv));
container.register('globalDb', asValue(globalFedifyKv));

container.register('events', asValue(new AsyncEvents()));

container.register(
    'flagService',
    asValue(new FlagService(['post_interaction_counts_update'])),
);

container.register(
    'fedifyContextFactory',
    asClass(FedifyContextFactory).singleton(),
);

container.register('storageService', asClass(GCPStorageService).singleton());

try {
    await container.resolve('storageService').init();
} catch (err) {
    globalLogging.error('Failed to initialise GCP storage service {error}', {
        error: err,
    });
    process.exit(1);
}

container.register(
    'storageAdapter',
    asFunction(() => {
        const bucketName = process.env.GCP_BUCKET_NAME || '';
        return new GCPStorageAdapter(
            bucketName,
            process.env.GCP_STORAGE_EMULATOR_HOST ?? undefined,
        );
    }).singleton(),
);

container.register('imageProcessor', asClass(ImageProcessor).singleton());

container.register(
    'imageStorageService',
    asClass(ImageStorageService).singleton(),
);

const eventSerializer = new EventSerializer();

eventSerializer.register(
    PostInteractionCountsUpdateRequestedEvent.getName(),
    PostInteractionCountsUpdateRequestedEvent,
);

let queue: GCloudPubSubPushMessageQueue | undefined;

if (process.env.USE_MQ === 'true') {
    globalLogging.info('Message queue is enabled');

    const pubSubClient = initPubSubClient({
        host: process.env.MQ_PUBSUB_HOST || 'unknown_pubsub_host',
        isEmulator: !['staging', 'production'].includes(
            process.env.NODE_ENV || 'unknown_node_env',
        ),
        projectId: process.env.MQ_PUBSUB_PROJECT_ID || 'unknown_project_id',
    });

    try {
        queue = new GCloudPubSubPushMessageQueue(
            globalLogging,
            pubSubClient,
            getFullTopic(
                pubSubClient.projectId,
                process.env.MQ_PUBSUB_TOPIC_NAME || 'unknown_pubsub_topic_name',
            ),
        );

        queue.registerErrorListener((error) => Sentry.captureException(error));

        container.register('queue', asValue(queue));

        container.register(
            'pubSubEvents',
            asValue(
                new PubSubEvents(
                    pubSubClient,
                    getFullTopic(
                        pubSubClient.projectId,
                        process.env.MQ_PUBSUB_GHOST_TOPIC_NAME ||
                            'unknown_pubsub_ghost_topic_name',
                    ),
                    eventSerializer,
                    globalLogging,
                ),
            ),
        );
    } catch (err) {
        globalLogging.error('Failed to initialise message queue {error}', {
            error: err,
        });

        process.exit(1);
    }
} else {
    globalLogging.info('Message queue is disabled');
}

export const globalFedify = createFederation<ContextData>({
    kv: globalFedifyKv,
    queue,
    manuallyStartQueue: process.env.MANUALLY_START_QUEUE === 'true',
    skipSignatureVerification:
        process.env.SKIP_SIGNATURE_VERIFICATION === 'true' &&
        ['development', 'testing'].includes(process.env.NODE_ENV || ''),
    allowPrivateAddress:
        process.env.ALLOW_PRIVATE_ADDRESS === 'true' &&
        ['development', 'testing'].includes(process.env.NODE_ENV || ''),
});

container.register('fedify', asValue(globalFedify));

/**
 * Fedify request context with app specific context data
 *
 * @see https://fedify.dev/manual/context
 */
export type FedifyRequestContext = RequestContext<ContextData>;
export type FedifyContext = Context<ContextData>;

if (process.env.MANUALLY_START_QUEUE === 'true') {
    globalFedify.startQueue({
        globaldb: globalFedifyKv,
        logger: globalLogging,
    });
}

container.register(
    'accountRepository',
    asClass(KnexAccountRepository).singleton(),
);
container.register('postRepository', asClass(KnexPostRepository).singleton());
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

container.register('followersService', asClass(FollowersService).singleton());
container.register('moderationService', asClass(ModerationService).singleton());
container.register(
    'notificationService',
    asClass(NotificationService).singleton(),
);
container.register('feedUpdateService', asClass(FeedUpdateService).singleton());
container.register(
    'notificationEventService',
    asClass(NotificationEventService).singleton(),
);

container.register('accountView', asClass(AccountView).singleton());
container.register(
    'accountFollowsView',
    asClass(AccountFollowsView).singleton(),
);
container.register('accountPostsView', asClass(AccountPostsView).singleton());
container.register('blocksView', asClass(BlocksView).singleton());
container.register('replyChainView', asClass(ReplyChainView).singleton());

container.register('blockController', asClass(BlockController).singleton());
container.register('followController', asClass(FollowController).singleton());
container.register('likeController', asClass(LikeController).singleton());

container.register('createHandler', asClass(CreateHandler).singleton());
container.register('deleteHandler', asClass(DeleteHandler).singleton());
container.register('followHandler', asClass(FollowHandler).singleton());
container.register('deleteDispatcher', asClass(DeleteDispatcher).singleton());

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

// Register API handler factories
container.register(
    'getSiteDataHandler',
    asFunction((siteService) => getSiteDataHandler(siteService)).singleton(),
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
    asFunction((accountView) => createSearchHandler(accountView)).singleton(),
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
    asFunction((accountRepository, accountPostsView, fedifyContextFactory) =>
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
    asFunction((accountRepository, accountFollowsView, fedifyContextFactory) =>
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
        (
            feedService,
            accountService,
            postInteractionCountsService,
            flagService,
        ) =>
            (feedType: 'Feed' | 'Inbox') =>
                createGetFeedHandler(
                    feedService,
                    accountService,
                    postInteractionCountsService,
                    flagService,
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
    asFunction((accountService, imageStorageService) =>
        createImageUploadHandler(accountService, imageStorageService),
    ).singleton(),
);

// Add missing factory for delete post handler
container.register(
    'deletePostHandler',
    asFunction((accountRepository, postRepository, postService) =>
        createDeletePostHandler(accountRepository, postRepository, postService),
    ).singleton(),
);

// Initialize services that need it
const fediverseBridge = container.resolve<FediverseBridge>('fediverseBridge');
fediverseBridge.init();

const feedUpdateService =
    container.resolve<FeedUpdateService>('feedUpdateService');
feedUpdateService.init();

const notificationEventService = container.resolve<NotificationEventService>(
    'notificationEventService',
);
notificationEventService.init();

const globalPostInteractionCountsService =
    container.resolve<PostInteractionCountsService>(
        'postInteractionCountsService',
    );
globalPostInteractionCountsService.init();

/** Fedify */

/**
 * Fedify does not pass the correct context object when running outside of the request context
 * for example in the context of the Inbox Queue - so we need to wrap handlers with this.
 */
function ensureCorrectContext<B, R>(
    fn: (ctx: Context<ContextData>, b: B) => Promise<R>,
) {
    return async (ctx: Context<ContextData>, b: B) => {
        if (!ctx.data) {
            // TODO: Clean up the any type
            // biome-ignore lint/suspicious/noExplicitAny: Legacy code needs proper typing
            (ctx as any).data = {};
        }
        if (!ctx.data.globaldb) {
            ctx.data.globaldb = globalFedifyKv;
        }
        if (!ctx.data.logger) {
            ctx.data.logger = globalLogging;
        }

        const fedifyContextFactory = container.resolve<FedifyContextFactory>(
            'fedifyContextFactory',
        );
        return fedifyContextFactory.registerContext(ctx, () => {
            return fn(ctx, b);
        });
    };
}

globalFedify
    // actorDispatcher uses RequestContext so doesn't need the ensureCorrectContext wrapper
    .setActorDispatcher(
        '/.ghost/activitypub/users/{identifier}',
        spanWrapper((ctx: RequestContext<ContextData>, identifier: string) => {
            const actorDispatcher = container.resolve('actorDispatcher');
            return actorDispatcher(ctx, identifier);
        }),
    )
    .mapHandle(async () => {
        return 'index'; // All identifiers are 'index'
    })
    .setKeyPairsDispatcher(
        ensureCorrectContext(
            spanWrapper((ctx: Context<ContextData>, identifier: string) => {
                const keypairDispatcher =
                    container.resolve('keypairDispatcher');
                return keypairDispatcher(ctx, identifier);
            }),
        ),
    );

const inboxListener = globalFedify.setInboxListeners(
    '/.ghost/activitypub/inbox/{identifier}',
    '/.ghost/activitypub/inbox',
);

inboxListener
    .on(
        Follow,
        ensureCorrectContext(
            spanWrapper((ctx: Context<ContextData>, activity: Follow) => {
                const followHandler =
                    container.resolve<FollowHandler>('followHandler');
                return followHandler.handle(ctx, activity);
            }),
        ),
    )
    .onError(inboxErrorHandler)
    .on(
        Accept,
        ensureCorrectContext(
            spanWrapper((ctx: Context<ContextData>, activity: Accept) => {
                const acceptHandler = container.resolve('acceptHandler');
                return acceptHandler(ctx, activity);
            }),
        ),
    )
    .onError(inboxErrorHandler)
    .on(
        Create,
        ensureCorrectContext(
            spanWrapper((ctx: Context<ContextData>, activity: Create) => {
                const createHandler =
                    container.resolve<CreateHandler>('createHandler');
                return createHandler.handle(ctx, activity);
            }),
        ),
    )
    .onError(inboxErrorHandler)
    .on(
        Delete,
        ensureCorrectContext(
            spanWrapper((ctx: Context<ContextData>, activity: Delete) => {
                const deleteHandler =
                    container.resolve<DeleteHandler>('deleteHandler');
                return deleteHandler.handle(ctx, activity);
            }),
        ),
    )
    .onError(inboxErrorHandler)
    .on(
        Announce,
        ensureCorrectContext(
            spanWrapper((ctx: Context<ContextData>, activity: Announce) => {
                const announceHandler = container.resolve('announceHandler');
                return announceHandler(ctx, activity);
            }),
        ),
    )
    .onError(inboxErrorHandler)
    .on(
        Like,
        ensureCorrectContext(
            spanWrapper((ctx: Context<ContextData>, activity: Like) => {
                const likeHandler = container.resolve('likeHandler');
                return likeHandler(ctx, activity);
            }),
        ),
    )
    .onError(inboxErrorHandler)
    .on(
        Undo,
        ensureCorrectContext(
            spanWrapper((ctx: Context<ContextData>, activity: Undo) => {
                const undoHandler = container.resolve('undoHandler');
                return undoHandler(ctx, activity);
            }),
        ),
    )
    .onError(inboxErrorHandler);

globalFedify
    .setFollowersDispatcher(
        '/.ghost/activitypub/followers/{identifier}',
        spanWrapper((ctx: Context<ContextData>, identifier: string) => {
            const followersDispatcher = container.resolve(
                'followersDispatcher',
            );
            return followersDispatcher(ctx, identifier);
        }),
    )
    .setCounter((ctx: RequestContext<ContextData>, identifier: string) => {
        const followersCounter = container.resolve('followersCounter');
        return followersCounter(ctx, identifier);
    });

globalFedify
    .setFollowingDispatcher(
        '/.ghost/activitypub/following/{identifier}',
        spanWrapper(
            (
                ctx: RequestContext<ContextData>,
                identifier: string,
                cursor: string | null,
            ) => {
                const followingDispatcher = container.resolve(
                    'followingDispatcher',
                );
                return followingDispatcher(ctx, identifier, cursor);
            },
        ),
    )
    .setCounter((ctx: RequestContext<ContextData>, identifier: string) => {
        const followingCounter = container.resolve('followingCounter');
        return followingCounter(ctx, identifier);
    })
    .setFirstCursor(followingFirstCursor);

globalFedify
    .setOutboxDispatcher(
        '/.ghost/activitypub/outbox/{identifier}',
        spanWrapper(outboxDispatcher),
    )
    .setCounter(outboxCounter)
    .setFirstCursor(outboxFirstCursor);

globalFedify
    .setLikedDispatcher(
        '/.ghost/activitypub/liked/{identifier}',
        spanWrapper(likedDispatcher),
    )
    .setCounter(likedCounter)
    .setFirstCursor(likedFirstCursor);

globalFedify.setObjectDispatcher(
    Article,
    '/.ghost/activitypub/article/{id}',
    spanWrapper(articleDispatcher),
);
globalFedify.setObjectDispatcher(
    Note,
    '/.ghost/activitypub/note/{id}',
    spanWrapper(noteDispatcher),
);
globalFedify.setObjectDispatcher(
    Follow,
    '/.ghost/activitypub/follow/{id}',
    spanWrapper(followDispatcher),
);
globalFedify.setObjectDispatcher(
    Accept,
    '/.ghost/activitypub/accept/{id}',
    spanWrapper(acceptDispatcher),
);
globalFedify.setObjectDispatcher(
    Reject,
    '/.ghost/activitypub/reject/{id}',
    spanWrapper(dispatchRejectActivity),
);
globalFedify.setObjectDispatcher(
    Create,
    '/.ghost/activitypub/create/{id}',
    spanWrapper(createDispatcher),
);
globalFedify.setObjectDispatcher(
    Update,
    '/.ghost/activitypub/update/{id}',
    spanWrapper(updateDispatcher),
);
globalFedify.setObjectDispatcher(
    Like,
    '/.ghost/activitypub/like/{id}',
    spanWrapper(likeDispatcher),
);
globalFedify.setObjectDispatcher(
    Undo,
    '/.ghost/activitypub/undo/{id}',
    spanWrapper(undoDispatcher),
);
globalFedify.setObjectDispatcher(
    Announce,
    '/.ghost/activitypub/announce/{id}',
    spanWrapper(announceDispatcher),
);
globalFedify.setObjectDispatcher(
    Delete,
    '/.ghost/activitypub/delete/{id}',
    spanWrapper(
        (ctx: RequestContext<ContextData>, data: Record<'id', string>) => {
            const deleteDispatcher =
                container.resolve<DeleteDispatcher>('deleteDispatcher');
            return deleteDispatcher.dispatch(ctx, data);
        },
    ),
);
globalFedify.setNodeInfoDispatcher(
    '/.ghost/activitypub/nodeinfo/2.1',
    spanWrapper(nodeInfoDispatcher),
);

/** Hono */

enum GhostRole {
    Anonymous = 'Anonymous',
    Owner = 'Owner',
    Administrator = 'Administrator',
    Editor = 'Editor',
    Author = 'Author',
    Contributor = 'Contributor',
}

export type HonoContextVariables = {
    globaldb: KvStore;
    logger: Logger;
    role: GhostRole;
    site: Site;
    account: Account;
};

const app = new Hono<{ Variables: HonoContextVariables }>();

/**
 * Hono context with app specific context variables
 *
 * @see https://hono.dev/docs/api/context
 */
export type AppContext = HonoContext<{ Variables: HonoContextVariables }>;

app.get('/ping', (ctx) => {
    return new Response('', {
        status: 200,
    });
});

/** Middleware */

app.use(async (ctx, next) => {
    const extra: Record<string, string | boolean> = {};

    const { traceId, spanId, sampled } = getTraceContext(
        ctx.req.header('traceparent'),
    );
    if (traceId && spanId) {
        extra['logging.googleapis.com/trace'] =
            `projects/ghost-activitypub/traces/${traceId}`;
        extra['logging.googleapis.com/spanId'] = spanId;
        extra['logging.googleapis.com/trace_sampled'] = sampled;
    }

    ctx.set('logger', globalLogging.with(extra));

    return Sentry.withIsolationScope((scope) => {
        scope.addEventProcessor((event) => {
            Sentry.addRequestDataToEvent(event, getRequestData(ctx.req.raw));
            return event;
        });

        return Sentry.continueTrace(
            {
                sentryTrace: ctx.req.header('sentry-trace'),
                baggage: ctx.req.header('baggage'),
            },
            () => {
                return Sentry.startSpan(
                    {
                        op: 'http.server',
                        name: `${ctx.req.method} ${ctx.req.path}`,
                        attributes: {
                            ...extra,
                            'service.name': 'activitypub',
                        },
                    },
                    () => {
                        return withContext(extra, () => {
                            return next();
                        });
                    },
                );
            },
        );
    });
});

app.use(async (ctx, next) => {
    ctx.set('globaldb', globalFedifyKv);

    return next();
});

container.register(
    'pubSubMessageHandler',
    asFunction((pubSubEvents, fedify, fedifyContextFactory) => {
        return createIncomingPubSubMessageHandler(
            pubSubEvents,
            fedify,
            fedifyContextFactory,
        );
    }).singleton(),
);

app.post('/.ghost/activitypub/pubsub/ghost/push', async (ctx) => {
    const handler = spanWrapper(
        container.resolve<
            ReturnType<typeof createIncomingPubSubMessageHandler>
        >('pubSubMessageHandler'),
    );
    return handler(ctx);
});

// This needs to go before the middleware which loads the site
// because this endpoint does not require the site to exist
if (queue instanceof GCloudPubSubPushMessageQueue) {
    app.post(
        '/.ghost/activitypub/mq',
        spanWrapper(createPushMessageHandler(queue, globalLogging)),
    );
}

app.use(
    cors({
        origin: (_origin, ctx) => {
            const referer = ctx.req.header('referer');
            const origin = ctx.req.header('origin');
            if (typeof referer === 'string') {
                return new URL(referer).origin;
            }
            if (typeof origin === 'string') {
                return new URL(origin).origin;
            }
            return '*';
        },
        credentials: true,
    }),
);

app.use(async (c, next) => {
    await next();
    c.res.headers.set(
        'Cache-Control',
        'no-cache, private, no-store, must-revalidate, max-stale=0, post-check=0, pre-check=0',
    );
});

app.use(async (ctx, next) => {
    if (ctx.req.url.endsWith('/')) {
        return ctx.redirect(ctx.req.url.slice(0, -1));
    }
    return next();
});

app.use(async (ctx, next) => {
    const id = crypto.randomUUID();
    const start = Date.now();

    ctx.get('logger').info('{method} {host} {url} {id}', {
        id,
        method: ctx.req.method.toUpperCase(),
        host: ctx.req.header('host'),
        url: ctx.req.url,
    });

    await next();
    const end = Date.now();

    ctx.get('logger').info('{method} {host} {url} {id} {status} {duration}ms', {
        id,
        method: ctx.req.method.toUpperCase(),
        host: ctx.req.header('host'),
        url: ctx.req.url,
        status: ctx.res.status,
        duration: end - start,
    });
});

app.use(async (ctx, next) => {
    const flagService = container.resolve('flagService');
    return flagService.runInContext(async () => {
        const enabledFlags: string[] = [];

        for (const flag of flagService.getRegistered()) {
            if (ctx.req.query(flag)) {
                flagService.enable(flag);

                enabledFlags.push(flag);
            }
        }

        if (enabledFlags.length > 0) {
            ctx.res.headers.set('x-enabled-flags', enabledFlags.join(','));
        }

        return next();
    });
});

function sleep(n: number) {
    return new Promise((resolve) => setTimeout(resolve, n));
}

async function getKey(jwksURL: URL, retries = 5) {
    try {
        const cachedKey = await globalFedifyKv.get([
            'cachedJwks',
            jwksURL.hostname,
        ]);
        if (cachedKey) {
            return cachedKey;
        }

        const jwksResponse = await fetch(jwksURL, {
            redirect: 'follow',
        });

        const jwks = await jwksResponse.json();

        const key = (await jose.JWK.asKey(jwks.keys[0])).toPEM();
        await globalFedifyKv.set(['cachedJwks', jwksURL.hostname], key);

        return key;
    } catch (err) {
        if (retries === 0) {
            throw err;
        }
        await sleep(100);
        return getKey(jwksURL, retries - 1);
    }
}

app.use(async (ctx, next) => {
    const request = ctx.req;
    const host = request.header('host');
    if (!host) {
        ctx.get('logger').info('No Host header');
        return new Response('No Host header', {
            status: 401,
        });
    }
    ctx.set('role', GhostRole.Anonymous);

    const authorization = request.header('authorization');

    if (!authorization) {
        return next();
    }

    const [match, token] = authorization.match(/Bearer\s+(.*)$/) || [null];

    if (!match) {
        ctx.get('logger').info('Invalid Authorization header');
        return new Response('Invalid Authorization header', {
            status: 401,
        });
    }

    let protocol = 'https';
    // We allow insecure requests when not in production for things like testing
    if (
        !['staging', 'production'].includes(process.env.NODE_ENV || '') &&
        !request.raw.url.startsWith('https')
    ) {
        protocol = 'http';
    }

    const jwksURL = new URL(
        '/ghost/.well-known/jwks.json',
        `${protocol}://${host}`,
    );

    const key = await getKey(jwksURL);
    try {
        const claims = jwt.verify(token, key);
        if (typeof claims === 'string' || typeof claims.role !== 'string') {
            return;
        }
        if (
            [
                'Owner',
                'Administrator',
                'Editor',
                'Author',
                'Contributor',
            ].includes(claims.role)
        ) {
            ctx.set(
                'role',
                GhostRole[
                    claims.role as
                        | 'Owner'
                        | 'Administrator'
                        | 'Editor'
                        | 'Author'
                        | 'Contributor'
                ],
            );
        } else {
            ctx.set('role', GhostRole.Anonymous);
        }
    } catch (err) {
        ctx.set('role', GhostRole.Anonymous);
    }

    await next();
});

app.use(async (ctx, next) => {
    const request = ctx.req;
    const host = request.header('host');
    if (!host) {
        ctx.get('logger').info('No Host header');
        return new Response('No Host header', {
            status: 401,
        });
    }
    await next();
});

// This needs to go before the middleware which loads the site
// Because the site doesn't always exist - this is how it's created
app.get(
    '/.ghost/activitypub/site',
    requireRole(GhostRole.Owner),
    spanWrapper((ctx: AppContext) => {
        const handler = container.resolve('getSiteDataHandler');
        return handler(ctx);
    }),
);

/**
 * Essentially Auth middleware and also handles the multitenancy
 */
app.use(async (ctx, next) => {
    const request = ctx.req;
    const host = request.header('host');
    if (!host) {
        ctx.get('logger').info('No Host header');
        return new Response('No Host header', {
            status: 401,
        });
    }
    const siteService = container.resolve<SiteService>('siteService');
    const site = await siteService.getSiteByHost(host);

    if (!site) {
        ctx.get('logger').info('No site found for {host}', { host });
        return new Response(null, {
            status: 403,
        });
    }

    ctx.set('site', site);

    await next();
});

app.use(async (ctx, next) => {
    const site = ctx.get('site');

    try {
        const accountRepository =
            container.resolve<KnexAccountRepository>('accountRepository');
        const account = await accountRepository.getBySite(ctx.get('site'));
        ctx.set('account', account);

        await next();
    } catch (err) {
        ctx.get('logger').error('No account found for {host}', {
            host: site.host,
        });
        return new Response('No account found', {
            status: 401,
        });
    }
});

app.use(async (ctx, next) => {
    const globaldb = ctx.get('globaldb');
    const logger = ctx.get('logger');

    const fedifyContext = globalFedify.createContext(ctx.req.raw as Request, {
        globaldb,
        logger,
    });

    const fedifyContextFactory = container.resolve<FedifyContextFactory>(
        'fedifyContextFactory',
    );
    await fedifyContextFactory.registerContext(fedifyContext, next);
});

/** Custom API routes */

function validateWebhook() {
    return async function webhookMiddleware(
        ctx: HonoContext<{ Variables: HonoContextVariables }>,
        next: Next,
    ) {
        const signature = ctx.req.header('x-ghost-signature') || '';
        const [matches, remoteHmac, timestamp] = signature.match(
            /sha256=([0-9a-f]+),\s+t=(\d+)/,
        ) || [null];
        if (!matches) {
            return new Response(null, {
                status: 401,
            });
        }

        const now = Date.now();

        if (Math.abs(now - Number.parseInt(timestamp)) > 5 * 60 * 1000) {
            return new Response(null, {
                status: 401,
            });
        }

        const body = await ctx.req.json();
        const site = ctx.get('site');
        const localHmac = createHmac('sha256', site.webhook_secret)
            .update(JSON.stringify(body) + timestamp)
            .digest('hex');

        if (localHmac !== remoteHmac) {
            return new Response(null, {
                status: 401,
            });
        }

        return next();
    };
}

app.post(
    '/.ghost/activitypub/webhooks/post/published',
    validateWebhook(),
    spanWrapper((ctx: AppContext) => {
        const handler = container.resolve('postPublishedWebhookHandler');
        return handler(ctx);
    }),
);

function requireRole(...roles: GhostRole[]) {
    return function roleMiddleware(ctx: HonoContext, next: Next) {
        if (!roles.includes(ctx.get('role'))) {
            return new Response(null, {
                status: 403,
            });
        }
        return next();
    };
}

app.get(
    '/.well-known/webfinger',
    spanWrapper((ctx: AppContext, next: Next) => {
        const handler = container.resolve('webFingerHandler');
        return handler(ctx, next);
    }),
);
app.post(
    '/.ghost/activitypub/actions/follow/:handle',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper((ctx: AppContext) => {
        const followController =
            container.resolve<FollowController>('followController');
        return followController.handleFollow(ctx);
    }),
);
app.post(
    '/.ghost/activitypub/actions/unfollow/:handle',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper((ctx: AppContext) => {
        const followController =
            container.resolve<FollowController>('followController');
        return followController.handleUnfollow(ctx);
    }),
);
app.post(
    '/.ghost/activitypub/actions/like/:id',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper((ctx: AppContext) => {
        const likeController =
            container.resolve<LikeController>('likeController');
        return likeController.handleLike(ctx);
    }),
);
app.post(
    '/.ghost/activitypub/actions/unlike/:id',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper((ctx: AppContext) => {
        const likeController =
            container.resolve<LikeController>('likeController');
        return likeController.handleUnlike(ctx);
    }),
);
app.post(
    '/.ghost/activitypub/actions/reply/:id',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper((ctx: AppContext) => {
        const postService = container.resolve('postService');
        return handleCreateReply(ctx, postService);
    }),
);
app.post(
    '/.ghost/activitypub/actions/repost/:id',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper((ctx: AppContext) => {
        const handler = container.resolve('repostActionHandler');
        return handler(ctx);
    }),
);
app.post(
    '/.ghost/activitypub/actions/derepost/:id',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper((ctx: AppContext) => {
        const handler = container.resolve('derepostActionHandler');
        return handler(ctx);
    }),
);
app.post(
    '/.ghost/activitypub/actions/note',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper((ctx: AppContext) => {
        const postService = container.resolve('postService');
        return handleCreateNote(ctx, postService);
    }),
);
app.get(
    '/.ghost/activitypub/actions/search',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper((ctx: AppContext) => {
        const handler = container.resolve('searchHandler');
        return handler(ctx);
    }),
);
app.get(
    '/.ghost/activitypub/thread/:post_ap_id',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper((ctx: AppContext) => {
        const handler = container.resolve('getThreadHandler');
        return handler(ctx);
    }),
);

app.get(
    '/.ghost/activitypub/replies/:post_ap_id',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper((ctx: AppContext) => {
        const controller = container.resolve('replyChainController');
        return controller.handleGetReplies(ctx);
    }),
);

app.get(
    '/.ghost/activitypub/account/:handle',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper((ctx: AppContext) => {
        const handler = container.resolve('getAccountHandler');
        return handler(ctx);
    }),
);
app.put(
    '/.ghost/activitypub/account',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper((ctx: AppContext) => {
        const handler = container.resolve('updateAccountHandler');
        return handler(ctx);
    }),
);
app.get(
    '/.ghost/activitypub/posts/:handle',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper((ctx: AppContext) => {
        const handler = container.resolve('getAccountPostsHandler');
        return handler(ctx);
    }),
);
app.get(
    '/.ghost/activitypub/posts/:handle/liked',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper((ctx: AppContext) => {
        const handler = container.resolve('getAccountLikedPostsHandler');
        return handler(ctx);
    }),
);
app.get(
    '/.ghost/activitypub/account/:handle/follows/:type',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper((ctx: AppContext) => {
        const handler = container.resolve('getAccountFollowsHandler');
        return handler(ctx);
    }),
);
app.get(
    '/.ghost/activitypub/feed',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper((ctx: AppContext) => {
        const handlerFactory = container.resolve('getFeedHandler');
        return handlerFactory('Feed')(ctx);
    }),
);
app.get(
    '/.ghost/activitypub/inbox',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper((ctx: AppContext) => {
        const handlerFactory = container.resolve('getFeedHandler');
        return handlerFactory('Inbox')(ctx);
    }),
);
app.get(
    '/.ghost/activitypub/post/:post_ap_id',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper((ctx: AppContext) => {
        const handler = container.resolve('getPostHandler');
        return handler(ctx);
    }),
);
app.delete(
    '/.ghost/activitypub/post/:id',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper((ctx: AppContext) => {
        const handler = container.resolve('deletePostHandler');
        return handler(ctx);
    }),
);
app.get(
    '/.ghost/activitypub/notifications',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper((ctx: AppContext) => {
        const controller = container.resolve('notificationController');
        return controller.handleGetNotifications(ctx);
    }),
);
app.get(
    '/.ghost/activitypub/notifications/unread/count',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper((ctx: AppContext) => {
        const controller = container.resolve('notificationController');
        return controller.handleGetUnreadNotificationsCount(ctx);
    }),
);
app.put(
    '/.ghost/activitypub/notifications/unread/reset',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper((ctx: AppContext) => {
        const controller = container.resolve('notificationController');
        return controller.handleResetUnreadNotificationsCount(ctx);
    }),
);
app.post(
    '/.ghost/activitypub/upload/image',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper((ctx: AppContext) => {
        const handler = container.resolve('imageUploadHandler');
        return handler(ctx);
    }),
);

app.post(
    '/.ghost/activitypub/actions/block/:id',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper((ctx: AppContext) => {
        const blockController =
            container.resolve<BlockController>('blockController');
        return blockController.handleBlock(ctx);
    }),
);

app.post(
    '/.ghost/activitypub/actions/unblock/:id',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper((ctx: AppContext) => {
        const blockController =
            container.resolve<BlockController>('blockController');
        return blockController.handleUnblock(ctx);
    }),
);

app.post(
    '/.ghost/activitypub/actions/block/domain/:domain',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper((ctx: AppContext) => {
        const blockController =
            container.resolve<BlockController>('blockController');
        return blockController.handleBlockDomain(ctx);
    }),
);

app.post(
    '/.ghost/activitypub/actions/unblock/domain/:domain',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper((ctx: AppContext) => {
        const blockController =
            container.resolve<BlockController>('blockController');
        return blockController.handleUnblockDomain(ctx);
    }),
);

app.get(
    '/.ghost/activitypub/blocks/accounts',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper((ctx: AppContext) => {
        const blockController =
            container.resolve<BlockController>('blockController');
        return blockController.handleGetBlockedAccounts(ctx);
    }),
);

app.get(
    '/.ghost/activitypub/blocks/domains',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper((ctx: AppContext) => {
        const blockController =
            container.resolve<BlockController>('blockController');
        return blockController.handleGetBlockedDomains(ctx);
    }),
);
/** Federation wire up */

app.get(
    '/.ghost/activitypub/followers/:handle',
    async (ctx: HonoContext, next: Next) => {
        await next();
        const logger = ctx.get('logger');
        try {
            const res = ctx.res.clone();
            const body = await res.json();
            logger.info(body.orderedItems.join(','));
        } catch (err) {
            if (err instanceof Error) {
                logger.error('{error}', { error: err.message });
            }
        }
    },
);

app.use(
    federation(
        globalFedify,
        (
            ctx: HonoContext<{ Variables: HonoContextVariables }>,
        ): ContextData => {
            return {
                globaldb: ctx.get('globaldb'),
                logger: ctx.get('logger'),
            };
        },
    ),
);

// Send errors to Sentry
app.onError((err, c) => {
    if (err.name === 'jsonld.SyntaxError') {
        const code = get(err, 'details.code');
        if (code === 'invalid term definition') {
            return BadRequest('Invalid JSON-LD');
        }
        if (code === 'invalid local context') {
            return BadRequest('Invalid JSON-LD');
        }
    }
    if (err.name === 'TypeError') {
        if (err.message === 'Invalid URL') {
            return BadRequest('Invalid URL');
        }
        if (err.message.includes('Invalid type')) {
            return BadRequest('Invalid type');
        }
    }
    Sentry.captureException(err);
    c.get('logger').error('{error}', { error: err });

    // TODO: should we return a JSON error?
    return c.text('Internal Server Error', 500);
});

function forceAcceptHeader(fn: (req: Request) => unknown) {
    return (request: Request) => {
        request.headers.set('accept', 'application/activity+json');
        return fn(request);
    };
}

serve(
    {
        fetch: forceAcceptHeader(behindProxy(app.fetch)),
        port: Number.parseInt(process.env.PORT || '8080'),
    },
    (info) => {
        globalLogging.info(
            `listening on ${info.address}:${info.port}, booted in {bootTime}ms`,
            {
                bootTime: Math.round(process.uptime() * 1000),
            },
        );
    },
);

process.on('SIGINT', () => process.exit(0));
