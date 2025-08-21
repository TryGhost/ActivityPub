import 'reflect-metadata';

import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac } from 'node:crypto';

import {
    Accept,
    Announce,
    Article,
    type Context,
    Create,
    Delete,
    type Federation,
    Follow,
    type KvStore,
    Like,
    Note,
    Reject,
    type RequestContext,
    Undo,
    Update,
} from '@fedify/fedify';
import { federation } from '@fedify/fedify/x/hono';
import { serve } from '@hono/node-server';
import {
    configure,
    getAnsiColorFormatter,
    getConsoleSink,
    isLogLevel,
    type Logger,
    type LogLevel,
    type LogRecord,
    withContext,
} from '@logtape/logtape';
import * as Sentry from '@sentry/node';
import { get } from 'es-toolkit/compat';
import { Hono, type Context as HonoContext, type Next } from 'hono';
import { cors } from 'hono/cors';
import { behindProxy } from 'x-forwarded-fetch';

import type { Account } from '@/account/account.entity';
import type { KnexAccountRepository } from '@/account/account.repository.knex';
import { dispatchRejectActivity } from '@/activity-dispatchers/reject.dispatcher';
import type { CreateHandler } from '@/activity-handlers/create.handler';
import type { DeleteHandler } from '@/activity-handlers/delete.handler';
import type { FollowHandler } from '@/activity-handlers/follow.handler';
import type { UpdateHandler } from '@/activity-handlers/update.handler';
import type { FedifyContextFactory } from '@/activitypub/fedify-context.factory';
import type { FediverseBridge } from '@/activitypub/fediverse-bridge';
import type { DeleteDispatcher } from '@/activitypub/object-dispatchers/delete.dispatcher';
import { container } from '@/configuration/container';
import { registerDependencies } from '@/configuration/registrations';
import { knex } from '@/db';
import {
    acceptDispatcher,
    announceDispatcher,
    articleDispatcher,
    createDispatcher,
    followDispatcher,
    followingFirstCursor,
    inboxErrorHandler,
    likeDispatcher,
    likedCounter,
    likedDispatcher,
    likedFirstCursor,
    nodeInfoDispatcher,
    noteDispatcher,
    outboxFirstCursor,
    undoDispatcher,
    updateDispatcher,
} from '@/dispatchers';
import type { EventSerializer } from '@/events/event';
import type { createIncomingPubSubMessageHandler } from '@/events/pubsub-http';
import type { GhostExploreService } from '@/explore/ghost-explore.service';
import type { FeedUpdateService } from '@/feed/feed-update.service';
import type { GhostPostService } from '@/ghost/ghost-post.service';
import { getTraceContext } from '@/helpers/context-header';
import { AccountController } from '@/http/api/account.controller';
import { BlockController } from '@/http/api/block.controller';
import { BlueskyController } from '@/http/api/bluesky.controller';
import { ClientConfigController } from '@/http/api/client-config.controller';
import { FeedController } from '@/http/api/feed.controller';
import { FollowController } from '@/http/api/follow.controller';
import { BadRequest } from '@/http/api/helpers/response';
import { LikeController } from '@/http/api/like.controller';
import { MediaController } from '@/http/api/media.controller';
import { NotificationController } from '@/http/api/notification.controller';
import { PostController } from '@/http/api/post.controller';
import { ReplyChainController } from '@/http/api/reply-chain.controller';
import { SearchController } from '@/http/api/search.controller';
import type { SiteController } from '@/http/api/site.controller';
import { WebFingerController } from '@/http/api/webfinger.controller';
import type { WebhookController } from '@/http/api/webhook.controller';
import {
    createRoleMiddleware,
    GhostRole,
    requireRole,
} from '@/http/middleware/role-guard';
import { RouteRegistry } from '@/http/routing/route-registry';
import { setupInstrumentation, spanWrapper } from '@/instrumentation';
import type { BlueskyService } from '@/integration/bluesky.service';
import {
    createPushMessageHandler,
    type GCloudPubSubPushMessageQueue,
} from '@/mq/gcloud-pubsub-push/mq';
import type { NotificationEventService } from '@/notification/notification-event.service';
import type { PostInteractionCountsService } from '@/post/post-interaction-counts.service';
import { PostInteractionCountsUpdateRequestedEvent } from '@/post/post-interaction-counts-update-requested.event';
import type { Site, SiteService } from '@/site/site.service';

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
        {
            category: ['logtape', 'meta'],
            sinks: ['console'],
            level: 'error',
        },
    ],
});

export type ContextData = {
    globaldb: KvStore;
    logger: Logger;
};

// Register all dependencies
registerDependencies(container, { knex });

const globalLogging = container.resolve<Logger>('logging');

// Init queue
const globalQueue = container.resolve<GCloudPubSubPushMessageQueue>('queue');

if (process.env.USE_MQ === 'true') {
    globalLogging.info('Message queue is enabled');

    globalQueue.registerErrorListener((error) => {
        Sentry.captureException(error);
    });
} else {
    globalLogging.info('Message queue is disabled');
}

/**
 * Fedify request context with app specific context data
 *
 * @see https://fedify.dev/manual/context
 */
export type FedifyRequestContext = RequestContext<ContextData>;
export type FedifyContext = Context<ContextData>;

const globalFedify = container.resolve<Federation<ContextData>>('fedify');
const globalFedifyKv = container.resolve<KvStore>('fedifyKv');
const globalKv = container.resolve<KvStore>('kv');

if (process.env.MANUALLY_START_QUEUE === 'true') {
    globalFedify.startQueue({
        globaldb: globalKv,
        logger: globalLogging,
    });
}

// Initialize services that need it
container.resolve<BlueskyService>('blueskyService').init();
container.resolve<FediverseBridge>('fediverseBridge').init();
container.resolve<FeedUpdateService>('feedUpdateService').init();
container.resolve<NotificationEventService>('notificationEventService').init();
container.resolve<GhostExploreService>('ghostExploreService').init();
container.resolve<GhostPostService>('ghostPostService').init();
container
    .resolve<PostInteractionCountsService>('postInteractionCountsService')
    .init();
container
    .resolve<EventSerializer>('eventSerializer')
    .register(
        PostInteractionCountsUpdateRequestedEvent.getName(),
        PostInteractionCountsUpdateRequestedEvent,
    );

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
            ctx.data.globaldb = globalKv;
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
    .onError(inboxErrorHandler)
    .on(
        Update,
        ensureCorrectContext(
            spanWrapper((ctx: Context<ContextData>, activity: Update) => {
                const updateHandler =
                    container.resolve<UpdateHandler>('updateHandler');
                return updateHandler.handle(ctx, activity);
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
        spanWrapper(
            (
                ctx: RequestContext<ContextData>,
                identifier: string,
                cursor: string | null,
            ) => {
                const outboxDispatcher = container.resolve('outboxDispatcher');
                return outboxDispatcher(ctx, identifier, cursor);
            },
        ),
    )
    .setCounter((ctx: RequestContext<ContextData>) => {
        const outboxCounter = container.resolve('outboxCounter');
        return outboxCounter(ctx);
    })
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

app.get('/ping', (_ctx) => {
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

    await withContext(extra, () => {
        return next();
    });

    // Uses the Hono path e.g. /path/:id instead of /path/123
    Sentry.getActiveSpan()?.updateName(
        `${ctx.req.method} ${ctx.req.routePath}`,
    );
});

app.use(async (ctx, next) => {
    ctx.set('globaldb', globalKv);

    return next();
});

app.post('/.ghost/activitypub/pubsub/ghost/push', async (ctx) => {
    const handler = spanWrapper(
        container.resolve<
            ReturnType<typeof createIncomingPubSubMessageHandler>
        >('pubSubMessageHandler'),
    );
    return handler(ctx);
});

app.post(
    '/.ghost/activitypub/pubsub/fedify/push',
    spanWrapper(createPushMessageHandler(globalQueue, globalLogging)),
);

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

    if (process.env.ACTIVITYPUB_SURROGATE_CACHE_CONTROL) {
        const isApiRequest = c.req.path.startsWith('/.ghost/activitypub/v1');

        if (!isApiRequest) {
            if (c.req.method === 'GET' || c.req.method === 'HEAD') {
                c.res.headers.set('Cache-Control', 'public, max-age=0');
                c.res.headers.set(
                    'Surrogate-Control',
                    process.env.ACTIVITYPUB_SURROGATE_CACHE_CONTROL,
                );
            }
        }
    }
});

app.use(async (ctx, next) => {
    if (ctx.req.url.endsWith('/')) {
        return ctx.redirect(ctx.req.url.slice(0, -1));
    }
    return next();
});

// Track in-flight requests
let activeRequests = 0;

app.use(async (ctx, next) => {
    const id = crypto.randomUUID();
    const start = Date.now();

    activeRequests++;

    ctx.get('logger').info('{method} {host} {url} {id}', {
        id,
        method: ctx.req.method.toUpperCase(),
        host: ctx.req.header('host'),
        url: ctx.req.url,
    });

    try {
        await next();
    } finally {
        activeRequests--;
        const end = Date.now();

        ctx.get('logger').info(
            '{method} {host} {url} {id} {status} {duration}ms',
            {
                id,
                method: ctx.req.method.toUpperCase(),
                host: ctx.req.header('host'),
                url: ctx.req.url,
                status: ctx.res.status,
                duration: end - start,
            },
        );
    }
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

app.use(createRoleMiddleware(globalFedifyKv));

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
// This needs to go before the middleware which loads the site
// Because the site doesn't always exist - this is how it's created
app.get(
    '/.ghost/activitypub/v1/site',
    requireRole(GhostRole.Owner),
    spanWrapper((ctx: AppContext) => {
        const siteController =
            container.resolve<SiteController>('siteController');
        return siteController.handleGetSiteData(ctx);
    }),
);

app.delete(
    '/.ghost/activitypub/v1/site',
    requireRole(GhostRole.Owner),
    spanWrapper((ctx: AppContext) => {
        const siteController =
            container.resolve<SiteController>('siteController');
        return siteController.handleDisableSite(ctx);
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
        return new Response(
            JSON.stringify({
                error: 'Forbidden',
                code: 'SITE_MISSING',
            }),
            {
                status: 403,
                headers: {
                    'Content-Type': 'application/json',
                },
            },
        );
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
    } catch (_err) {
        ctx.get('logger').error('No account found for {host}', {
            host: site.host,
        });
        return new Response('No account found', {
            status: 401,
        });
    }
});

/** Custom API routes */

const routeRegistry = new RouteRegistry();

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
    '/.ghost/activitypub/v1/webhooks/post/published',
    validateWebhook(),
    spanWrapper((ctx: AppContext) => {
        const webhookController =
            container.resolve<WebhookController>('webhookController');
        return webhookController.handlePostPublished(ctx);
    }),
);

app.post(
    '/.ghost/activitypub/v1/webhooks/post/unpublished',
    validateWebhook(),
    spanWrapper((ctx: AppContext) => {
        const webhookController =
            container.resolve<WebhookController>('webhookController');
        return webhookController.handlePostUnpublished(ctx);
    }),
);

app.post(
    '/.ghost/activitypub/v1/webhooks/post/updated',
    validateWebhook(),
    spanWrapper((ctx: AppContext) => {
        const webhookController =
            container.resolve<WebhookController>('webhookController');
        return webhookController.handlePostUpdated(ctx);
    }),
);

app.post(
    '/.ghost/activitypub/v1/webhooks/post/deleted',
    validateWebhook(),
    spanWrapper((ctx: AppContext) => {
        const webhookController =
            container.resolve<WebhookController>('webhookController');
        return webhookController.handlePostDeleted(ctx);
    }),
);

routeRegistry.registerController('webFingerController', WebFingerController);
routeRegistry.registerController('followController', FollowController);
routeRegistry.registerController('likeController', LikeController);
routeRegistry.registerController('postController', PostController);
routeRegistry.registerController('searchController', SearchController);
routeRegistry.registerController('replyChainController', ReplyChainController);
routeRegistry.registerController('accountController', AccountController);
routeRegistry.registerController('feedController', FeedController);
routeRegistry.registerController(
    'notificationController',
    NotificationController,
);
routeRegistry.registerController('mediaController', MediaController);
routeRegistry.registerController('blockController', BlockController);
routeRegistry.registerController(
    'clientConfigController',
    ClientConfigController,
);
routeRegistry.registerController('blueskyController', BlueskyController);

// Mount all registered routes
routeRegistry.mountRoutes(app, container);

/** Federation wire up */
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

let isShuttingDown = false;
async function gracefulShutdown(signal: 'SIGINT' | 'SIGTERM') {
    if (isShuttingDown) return;
    isShuttingDown = true;
    globalLogging.info(
        `Received ${signal}, shutting down gracefully. Active requests: ${activeRequests}`,
    );
    const requestMonitor = setInterval(() => {
        if (activeRequests > 0) {
            globalLogging.info(
                `Waiting for ${activeRequests} in-flight requests to complete...`,
            );
        }
    }, 1000);
    try {
        const maxWaitTime = 9000;
        const startTime = Date.now();
        while (activeRequests > 0 && Date.now() - startTime < maxWaitTime) {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (activeRequests > 0) {
            globalLogging.warn(
                `Shutting down with ${activeRequests} requests still in flight`,
            );
        } else {
            globalLogging.info('All requests completed');
        }
        clearInterval(requestMonitor);
        await knex.destroy();
        globalLogging.info('DB connection closed');
        await Sentry.close(1000);
    } catch (err) {
        globalLogging.error(
            'Error while closing DB connection on {signal}: {error}',
            {
                signal: signal,
                error: err,
            },
        );
    } finally {
        clearInterval(requestMonitor);
        process.exit(0);
    }
}

process.on('SIGINT', () => {
    if (['development', 'testing'].includes(process.env.NODE_ENV || '')) {
        process.exit(0);
    }
    void gracefulShutdown('SIGINT');
});
process.on('SIGTERM', () => {
    if (['development', 'testing'].includes(process.env.NODE_ENV || '')) {
        process.exit(0);
    }
    void gracefulShutdown('SIGTERM');
});
