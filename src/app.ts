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
import { AsyncEvents } from 'core/events';
import { Hono, type Context as HonoContext, type Next } from 'hono';
import { cors } from 'hono/cors';
import { BlockController } from 'http/api/block';
import { createDerepostActionHandler } from 'http/api/derepost';
import { FollowController } from 'http/api/follow';
import { LikeController } from 'http/api/like';
import { handleCreateReply } from 'http/api/reply';
import { createRepostActionHandler } from 'http/api/repost';
import jwt from 'jsonwebtoken';
import { ModerationService } from 'moderation/moderation.service';
import jose from 'node-jose';
import { NotificationEventService } from 'notification/notification-event.service';
import { NotificationService } from 'notification/notification.service';
import { KnexPostRepository } from 'post/post.repository.knex';
import { behindProxy } from 'x-forwarded-fetch';
import { AccountService } from './account/account.service';
import { dispatchRejectActivity } from './activity-dispatchers/reject.dispatcher';
import { DeleteHandler } from './activity-handlers/delete.handler';
import { FedifyContextFactory } from './activitypub/fedify-context.factory';
import { FediverseBridge } from './activitypub/fediverse-bridge';
import { client } from './db';
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
import { getSiteDataHandler, inboxHandler } from './handlers';
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
    createGetNotificationsHandler,
    createGetPostHandler,
    createGetThreadHandler,
    createPostPublishedWebhookHandler,
    createSearchHandler,
    createStorageHandler,
    createUpdateAccountHandler,
    handleCreateNote,
} from './http/api';
import { AccountFollowsView } from './http/api/views/account.follows.view';
import { AccountPostsView } from './http/api/views/account.posts.view';
import { AccountView } from './http/api/views/account.view';
import { createWebFingerHandler } from './http/handler/webfinger';
import { setupInstrumentation, spanWrapper } from './instrumentation';
import { KnexKvStore } from './knex.kvstore';
import { scopeKvStore } from './kv-helpers';
import {
    GCloudPubSubPushMessageQueue,
    createMessageQueue,
    createPushMessageHandler,
} from './mq/gcloud-pubsub-push/mq';
import { PostService } from './post/post.service';
import { type Site, SiteService } from './site/site.service';
import { GCPStorageService } from './storage/gcloud-storage/gcp-storage.service';

await setupInstrumentation();

const logging = getLogger(['activitypub']);

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
    db: KvStore;
    globaldb: KvStore;
    logger: Logger;
};

const fedifyKv = await KnexKvStore.create(client, 'key_value');

const gcpStorageService = new GCPStorageService(logging);

try {
    await gcpStorageService.init();
    logging.info('GCP storage service initialised');
} catch (err) {
    logging.error('Failed to initialise GCP storage service {error}', {
        error: err,
    });
    process.exit(1);
}

let queue: GCloudPubSubPushMessageQueue | undefined;

if (process.env.USE_MQ === 'true') {
    logging.info('Message queue is enabled');

    try {
        queue = await createMessageQueue(logging, {
            pubSubHost: process.env.MQ_PUBSUB_HOST,
            hostIsEmulator: !['staging', 'production'].includes(
                process.env.NODE_ENV || '',
            ),
            projectId: process.env.MQ_PUBSUB_PROJECT_ID,
            topic: String(process.env.MQ_PUBSUB_TOPIC_NAME),
            subscription: process.env.MQ_PUBSUB_SUBSCRIPTION_NAME
                ? String(process.env.MQ_PUBSUB_SUBSCRIPTION_NAME)
                : undefined,
        });

        queue.registerErrorListener((error) => Sentry.captureException(error));
    } catch (err) {
        logging.error('Failed to initialise message queue {error}', {
            error: err,
        });

        process.exit(1);
    }
} else {
    logging.info('Message queue is disabled');
}

export const fedify = createFederation<ContextData>({
    kv: fedifyKv,
    queue,
    manuallyStartQueue: process.env.MANUALLY_START_QUEUE === 'true',
    skipSignatureVerification:
        process.env.SKIP_SIGNATURE_VERIFICATION === 'true' &&
        ['development', 'testing'].includes(process.env.NODE_ENV || ''),
    allowPrivateAddress:
        process.env.ALLOW_PRIVATE_ADDRESS === 'true' &&
        ['development', 'testing'].includes(process.env.NODE_ENV || ''),
});

/**
 * Fedify request context with app specific context data
 *
 * @see https://fedify.dev/manual/context
 */
export type FedifyRequestContext = RequestContext<ContextData>;
export type FedifyContext = Context<ContextData>;

export const db = await KnexKvStore.create(client, 'key_value');

if (process.env.MANUALLY_START_QUEUE === 'true') {
    fedify.startQueue({
        db: scopeKvStore(db, ['UNUSED_HOST']),
        globaldb: db,
        logger: logging,
    });
}

const flagService = new FlagService([]);

const events = new AsyncEvents();
const fedifyContextFactory = new FedifyContextFactory();

const accountRepository = new KnexAccountRepository(client, events);
const postRepository = new KnexPostRepository(client, events);

const accountService = new AccountService(
    client,
    events,
    accountRepository,
    fedifyContextFactory,
);

const followersService = new FollowersService(client);

const moderationService = new ModerationService(client);

const postService = new PostService(
    postRepository,
    accountService,
    fedifyContextFactory,
    gcpStorageService,
    moderationService,
);

const accountView = new AccountView(client, fedifyContextFactory);
const accountFollowsView = new AccountFollowsView(
    client,
    fedifyContextFactory,
    moderationService,
);
const accountPostsView = new AccountPostsView(client, fedifyContextFactory);
const siteService = new SiteService(client, accountService, {
    getSiteSettings: getSiteSettings,
});
const feedService = new FeedService(client, moderationService);
const feedUpdateService = new FeedUpdateService(events, feedService);
feedUpdateService.init();

const fediverseBridge = new FediverseBridge(
    events,
    fedifyContextFactory,
    accountService,
);
fediverseBridge.init();

const notificationService = new NotificationService(client, moderationService);
const notificationEventService = new NotificationEventService(
    events,
    notificationService,
);
notificationEventService.init();

const blockController = new BlockController(accountService);
const followController = new FollowController(
    accountService,
    moderationService,
);
const likeController = new LikeController(
    accountRepository,
    postService,
    postRepository,
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
        const host = ctx.host;
        if (!ctx.data) {
            // TODO: Clean up the any type
            // biome-ignore lint/suspicious/noExplicitAny: Legacy code needs proper typing
            (ctx as any).data = {};
        }
        if (!ctx.data.globaldb) {
            ctx.data.globaldb = db;
        }
        if (!ctx.data.logger) {
            ctx.data.logger = logging;
        }
        // Ensure scoped data / objects are initialised on each execution
        // of this function - Fedify may reuse the context object across
        // multiple executions of an inbox listener
        ctx.data.db = scopeKvStore(db, ['sites', host]);

        return fedifyContextFactory.registerContext(ctx, () => {
            return fn(ctx, b);
        });
    };
}

fedify
    // actorDispatcher uses RequestContext so doesn't need the ensureCorrectContext wrapper
    .setActorDispatcher(
        '/.ghost/activitypub/users/{handle}',
        spanWrapper(actorDispatcher(siteService, accountService)),
    )
    .setKeyPairsDispatcher(
        ensureCorrectContext(
            spanWrapper(keypairDispatcher(siteService, accountService)),
        ),
    );

const inboxListener = fedify.setInboxListeners(
    '/.ghost/activitypub/inbox/{handle}',
    '/.ghost/activitypub/inbox',
);

const createHandler = new CreateHandler(
    postService,
    accountService,
    siteService,
);

const deleteHandler = new DeleteHandler(
    postService,
    accountService,
    postRepository,
);

const followHandler = new FollowHandler(accountService, moderationService);

const deleteDispatcher = new DeleteDispatcher();

inboxListener
    .on(
        Follow,
        ensureCorrectContext(
            spanWrapper(followHandler.handle.bind(followHandler)),
        ),
    )
    .onError(inboxErrorHandler)
    .on(
        Accept,
        ensureCorrectContext(spanWrapper(createAcceptHandler(accountService))),
    )
    .onError(inboxErrorHandler)
    .on(
        Create,
        ensureCorrectContext(
            spanWrapper(createHandler.handle.bind(createHandler)),
        ),
    )
    .onError(inboxErrorHandler)
    .on(
        Delete,
        ensureCorrectContext(
            spanWrapper(deleteHandler.handle.bind(deleteHandler)),
        ),
    )
    .onError(inboxErrorHandler)
    .on(
        Announce,
        ensureCorrectContext(
            spanWrapper(
                createAnnounceHandler(
                    siteService,
                    accountService,
                    postService,
                    postRepository,
                ),
            ),
        ),
    )
    .onError(inboxErrorHandler)
    .on(
        Like,
        ensureCorrectContext(
            spanWrapper(
                createLikeHandler(accountService, postRepository, postService),
            ),
        ),
    )
    .onError(inboxErrorHandler)
    .on(
        Undo,
        ensureCorrectContext(
            spanWrapper(
                createUndoHandler(accountService, postRepository, postService),
            ),
        ),
    )
    .onError(inboxErrorHandler);

fedify
    .setFollowersDispatcher(
        '/.ghost/activitypub/followers/{handle}',
        spanWrapper(
            createFollowersDispatcher(
                siteService,
                accountRepository,
                followersService,
            ),
        ),
    )
    .setCounter(createFollowersCounter(siteService, accountService));

fedify
    .setFollowingDispatcher(
        '/.ghost/activitypub/following/{handle}',
        spanWrapper(createFollowingDispatcher(siteService, accountService)),
    )
    .setCounter(createFollowingCounter(siteService, accountService))
    .setFirstCursor(followingFirstCursor);

fedify
    .setOutboxDispatcher(
        '/.ghost/activitypub/outbox/{handle}',
        spanWrapper(outboxDispatcher),
    )
    .setCounter(outboxCounter)
    .setFirstCursor(outboxFirstCursor);

fedify
    .setLikedDispatcher(
        '/.ghost/activitypub/liked/{handle}',
        spanWrapper(likedDispatcher),
    )
    .setCounter(likedCounter)
    .setFirstCursor(likedFirstCursor);

fedify.setObjectDispatcher(
    Article,
    '/.ghost/activitypub/article/{id}',
    spanWrapper(articleDispatcher),
);
fedify.setObjectDispatcher(
    Note,
    '/.ghost/activitypub/note/{id}',
    spanWrapper(noteDispatcher),
);
fedify.setObjectDispatcher(
    Follow,
    '/.ghost/activitypub/follow/{id}',
    spanWrapper(followDispatcher),
);
fedify.setObjectDispatcher(
    Accept,
    '/.ghost/activitypub/accept/{id}',
    spanWrapper(acceptDispatcher),
);
fedify.setObjectDispatcher(
    Reject,
    '/.ghost/activitypub/reject/{id}',
    spanWrapper(dispatchRejectActivity),
);
fedify.setObjectDispatcher(
    Create,
    '/.ghost/activitypub/create/{id}',
    spanWrapper(createDispatcher),
);
fedify.setObjectDispatcher(
    Update,
    '/.ghost/activitypub/update/{id}',
    spanWrapper(updateDispatcher),
);
fedify.setObjectDispatcher(
    Like,
    '/.ghost/activitypub/like/{id}',
    spanWrapper(likeDispatcher),
);
fedify.setObjectDispatcher(
    Undo,
    '/.ghost/activitypub/undo/{id}',
    spanWrapper(undoDispatcher),
);
fedify.setObjectDispatcher(
    Announce,
    '/.ghost/activitypub/announce/{id}',
    spanWrapper(announceDispatcher),
);
fedify.setObjectDispatcher(
    Delete,
    '/.ghost/activitypub/delete/{id}',
    spanWrapper(deleteDispatcher.dispatch.bind(deleteDispatcher)),
);
fedify.setNodeInfoDispatcher(
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
    db: KvStore;
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

    ctx.set('logger', logging.with(extra));

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

// This needs to go before the middleware which loads the site
// because this endpoint does not require the site to exist
if (queue instanceof GCloudPubSubPushMessageQueue) {
    app.post(
        '/.ghost/activitypub/mq',
        spanWrapper(createPushMessageHandler(queue, logging)),
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
        const jwksResponse = await fetch(jwksURL, {
            redirect: 'follow',
        });

        const jwks = await jwksResponse.json();

        const key = await jose.JWK.asKey(jwks.keys[0]);

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
        const claims = jwt.verify(token, key.toPEM());
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

    const scopedDb = scopeKvStore(db, ['sites', host]);

    ctx.set('db', scopedDb);
    ctx.set('globaldb', db);

    await next();
});

// This needs to go before the middleware which loads the site
// Because the site doesn't always exist - this is how it's created
app.get(
    '/.ghost/activitypub/site',
    requireRole(GhostRole.Owner),
    getSiteDataHandler(siteService),
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
    const db = ctx.get('db');
    const globaldb = ctx.get('globaldb');
    const logger = ctx.get('logger');

    const fedifyContext = fedify.createContext(ctx.req.raw as Request, {
        db,
        globaldb,
        logger,
    });

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
    spanWrapper(
        createPostPublishedWebhookHandler(accountRepository, postRepository),
    ),
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
    spanWrapper(createWebFingerHandler(accountRepository, siteService)),
);

app.get(
    '/.ghost/activitypub/inbox/:handle',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper(inboxHandler),
);
app.post(
    '/.ghost/activitypub/actions/follow/:handle',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper((ctx: AppContext) => followController.handleFollow(ctx)),
);
app.post(
    '/.ghost/activitypub/actions/unfollow/:handle',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper((ctx: AppContext) => followController.handleUnfollow(ctx)),
);
app.post(
    '/.ghost/activitypub/actions/like/:id',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper((ctx: AppContext) => likeController.handleLike(ctx)),
);
app.post(
    '/.ghost/activitypub/actions/unlike/:id',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper((ctx: AppContext) => likeController.handleUnlike(ctx)),
);
app.post(
    '/.ghost/activitypub/actions/reply/:id',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper((ctx: AppContext) => handleCreateReply(ctx, postService)),
);
app.post(
    '/.ghost/activitypub/actions/repost/:id',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper(createRepostActionHandler(postService)),
);
app.post(
    '/.ghost/activitypub/actions/derepost/:id',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper(
        createDerepostActionHandler(
            accountRepository,
            postService,
            postRepository,
        ),
    ),
);
app.post(
    '/.ghost/activitypub/actions/note',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper((ctx: AppContext) => handleCreateNote(ctx, postService)),
);
app.get(
    '/.ghost/activitypub/actions/search',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper(createSearchHandler(accountView)),
);
app.get(
    '/.ghost/activitypub/thread/:post_ap_id',
    spanWrapper(createGetThreadHandler(postRepository, accountService)),
);
app.get(
    '/.ghost/activitypub/account/:handle',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper(createGetAccountHandler(accountView, accountRepository)),
);
app.put(
    '/.ghost/activitypub/account',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper(createUpdateAccountHandler(accountService)),
);
app.get(
    '/.ghost/activitypub/posts/:handle',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper(
        createGetAccountPostsHandler(
            accountRepository,
            accountPostsView,
            fedifyContextFactory,
        ),
    ),
);
app.get(
    '/.ghost/activitypub/posts/:handle/liked',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper(
        createGetAccountLikedPostsHandler(accountService, accountPostsView),
    ),
);
app.get(
    '/.ghost/activitypub/account/:handle/follows/:type',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper(
        createGetAccountFollowsHandler(
            accountRepository,
            accountFollowsView,
            fedifyContextFactory,
        ),
    ),
);
app.get(
    '/.ghost/activitypub/feed',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper(createGetFeedHandler(feedService, accountService, 'Feed')),
);
app.get(
    '/.ghost/activitypub/inbox',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper(createGetFeedHandler(feedService, accountService, 'Inbox')),
);
app.get(
    '/.ghost/activitypub/post/:post_ap_id',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper(createGetPostHandler(postService, accountService)),
);
app.delete(
    '/.ghost/activitypub/post/:id',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper(
        createDeletePostHandler(accountRepository, postRepository, postService),
    ),
);
app.get(
    '/.ghost/activitypub/notifications',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper(
        createGetNotificationsHandler(accountService, notificationService),
    ),
);
app.post(
    '/.ghost/activitypub/upload/image',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper(createStorageHandler(accountService, gcpStorageService)),
);

app.post(
    '/.ghost/activitypub/actions/block/:id',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper((ctx: AppContext) => blockController.handleBlock(ctx)),
);

app.post(
    '/.ghost/activitypub/actions/unblock/:id',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper((ctx: AppContext) => blockController.handleUnblock(ctx)),
);

app.post(
    '/.ghost/activitypub/actions/block/domain/:domain',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper((ctx: AppContext) => blockController.handleBlockDomain(ctx)),
);

app.post(
    '/.ghost/activitypub/actions/unblock/domain/:domain',
    requireRole(GhostRole.Owner, GhostRole.Administrator),
    spanWrapper((ctx: AppContext) => blockController.handleUnblockDomain(ctx)),
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
        fedify,
        (
            ctx: HonoContext<{ Variables: HonoContextVariables }>,
        ): ContextData => {
            return {
                db: ctx.get('db'),
                globaldb: ctx.get('globaldb'),
                logger: ctx.get('logger'),
            };
        },
    ),
);

// Send errors to Sentry
app.onError((err, c) => {
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
        logging.info(
            `listening on ${info.address}:${info.port}, booted in {bootTime}ms`,
            {
                bootTime: Math.round(process.uptime() * 1000),
            },
        );
    },
);

process.on('SIGINT', () => process.exit(0));
