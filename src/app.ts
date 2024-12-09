import './instrumentation';

import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac } from 'node:crypto';
import {
    Accept,
    Announce,
    Article,
    type Context,
    Create,
    Follow,
    type KvStore,
    Like,
    Note,
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
import { Hono, type Context as HonoContext, type Next } from 'hono';
import { cors } from 'hono/cors';
import jwt from 'jsonwebtoken';
import jose from 'node-jose';
import { behindProxy } from 'x-forwarded-fetch';
import {
    getActivitiesAction,
    getActivityThreadAction,
    profileGetAction,
    profileGetFollowersAction,
    profileGetFollowingAction,
    profileGetPostsAction,
    searchAction,
} from './api';
import { client, getSite } from './db';
import {
    acceptDispatcher,
    actorDispatcher,
    articleDispatcher,
    createDispatcher,
    followDispatcher,
    followersCounter,
    followersDispatcher,
    followersFirstCursor,
    followingCounter,
    followingDispatcher,
    followingFirstCursor,
    handleAccept,
    handleAnnounce,
    handleCreate,
    handleFollow,
    handleLike,
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
import {
    followAction,
    inboxHandler,
    likeAction,
    noteAction,
    postPublishedWebhook,
    replyAction,
    siteChangedWebhook,
    unlikeAction,
} from './handlers';
import { getTraceContext } from './helpers/context-header';
import { getRequestData } from './helpers/request-data';
import { spanWrapper } from './instrumentation';
import { KnexKvStore } from './knex.kvstore';
import { scopeKvStore } from './kv-helpers';
import {
    GCloudPubSubPushMessageQueue,
    createMessageQueue,
    handlePushMessage,
} from './mq/gcloud-pubsub-push/mq';

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

let queue: GCloudPubSubPushMessageQueue | undefined;

if (process.env.USE_MQ === 'true') {
    logging.info('Message queue is enabled');

    try {
        queue = await createMessageQueue(logging, {
            pubSubHost: process.env.MQ_PUBSUB_HOST,
            hostIsEmulator: process.env.NODE_ENV !== 'production',
            projectId: process.env.MQ_PUBSUB_PROJECT_ID,
            topic: String(process.env.MQ_PUBSUB_TOPIC_NAME),
            subscription: String(process.env.MQ_PUBSUB_SUBSCRIPTION_NAME),
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
    skipSignatureVerification:
        process.env.SKIP_SIGNATURE_VERIFICATION === 'true' &&
        ['development', 'testing'].includes(process.env.NODE_ENV || ''),
    allowPrivateAddress:
        process.env.ALLOW_PRIVATE_ADDRESS === 'true' &&
        ['development', 'testing'].includes(process.env.NODE_ENV || ''),
});

export const db = await KnexKvStore.create(client, 'key_value');

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
        return fn(ctx, b);
    };
}

fedify
    // actorDispatcher uses RequestContext so doesn't need the ensureCorrectContext wrapper
    .setActorDispatcher(
        '/.ghost/activitypub/users/{handle}',
        spanWrapper(actorDispatcher),
    )
    .setKeyPairsDispatcher(
        ensureCorrectContext(spanWrapper(keypairDispatcher)),
    );

const inboxListener = fedify.setInboxListeners(
    '/.ghost/activitypub/inbox/{handle}',
    '/.ghost/activitypub/inbox',
);

inboxListener
    .on(Follow, ensureCorrectContext(spanWrapper(handleFollow)))
    .onError(inboxErrorHandler)
    .on(Accept, ensureCorrectContext(spanWrapper(handleAccept)))
    .onError(inboxErrorHandler)
    .on(Create, ensureCorrectContext(spanWrapper(handleCreate)))
    .onError(inboxErrorHandler)
    .on(Announce, ensureCorrectContext(spanWrapper(handleAnnounce)))
    .onError(inboxErrorHandler)
    .on(Like, ensureCorrectContext(spanWrapper(handleLike)))
    .onError(inboxErrorHandler);

fedify
    .setFollowersDispatcher(
        '/.ghost/activitypub/followers/{handle}',
        spanWrapper(followersDispatcher),
    )
    .setCounter(followersCounter)
    .setFirstCursor(followersFirstCursor);

fedify
    .setFollowingDispatcher(
        '/.ghost/activitypub/following/{handle}',
        spanWrapper(followingDispatcher),
    )
    .setCounter(followingCounter)
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
    site: {
        host: string;
        webhook_secret: string;
    };
};

const app = new Hono<{ Variables: HonoContextVariables }>();

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
        process.env.NODE_ENV !== 'production' &&
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

// This needs to go before the middleware which loads the site
// because this endpoint does not require the site to exist
if (queue instanceof GCloudPubSubPushMessageQueue) {
    app.post('/.ghost/activitypub/mq', spanWrapper(handlePushMessage(queue)));
}

// This needs to go before the middleware which loads the site
// Because the site doesn't always exist - this is how it's created
app.get(
    '/.ghost/activitypub/site',
    requireRole(GhostRole.Owner),
    async (ctx) => {
        const request = ctx.req;
        const host = request.header('host');
        if (!host) {
            ctx.get('logger').info('No Host header');
            return new Response('No Host header', {
                status: 401,
            });
        }

        const site = await getSite(host, true);

        return new Response(JSON.stringify(site), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
            },
        });
    },
);

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

    const site = await getSite(host);

    if (!site) {
        ctx.get('logger').info('No site found for {host}', { host });
        return new Response(null, {
            status: 403,
        });
    }

    ctx.set('db', scopedDb);
    ctx.set('globaldb', db);
    ctx.set('site', site);

    await next();
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
    spanWrapper(postPublishedWebhook),
);
app.post(
    '/.ghost/activitypub/webhooks/site/changed',
    validateWebhook(),
    spanWrapper(siteChangedWebhook),
);

function requireRole(role: GhostRole) {
    return function roleMiddleware(ctx: HonoContext, next: Next) {
        if (ctx.get('role') !== role) {
            return new Response(null, {
                status: 403,
            });
        }
        return next();
    };
}

app.get(
    '/.ghost/activitypub/inbox/:handle',
    requireRole(GhostRole.Owner),
    spanWrapper(inboxHandler),
);
app.get(
    '/.ghost/activitypub/activities/:handle',
    requireRole(GhostRole.Owner),
    spanWrapper(getActivitiesAction),
);
app.post(
    '/.ghost/activitypub/actions/follow/:handle',
    requireRole(GhostRole.Owner),
    spanWrapper(followAction),
);
app.post(
    '/.ghost/activitypub/actions/like/:id',
    requireRole(GhostRole.Owner),
    spanWrapper(likeAction),
);
app.post(
    '/.ghost/activitypub/actions/unlike/:id',
    requireRole(GhostRole.Owner),
    spanWrapper(unlikeAction),
);
app.post(
    '/.ghost/activitypub/actions/reply/:id',
    requireRole(GhostRole.Owner),
    spanWrapper(replyAction),
);
app.post(
    '/.ghost/activitypub/actions/note',
    requireRole(GhostRole.Owner),
    spanWrapper(noteAction),
);
app.get(
    '/.ghost/activitypub/actions/search',
    requireRole(GhostRole.Owner),
    spanWrapper(searchAction),
);
app.get(
    '/.ghost/activitypub/profile/:handle',
    requireRole(GhostRole.Owner),
    spanWrapper(profileGetAction),
);
app.get(
    '/.ghost/activitypub/profile/:handle/followers',
    requireRole(GhostRole.Owner),
    spanWrapper(profileGetFollowersAction),
);
app.get(
    '/.ghost/activitypub/profile/:handle/following',
    requireRole(GhostRole.Owner),
    spanWrapper(profileGetFollowingAction),
);
app.get(
    '/.ghost/activitypub/profile/:handle/posts',
    requireRole(GhostRole.Owner),
    spanWrapper(profileGetPostsAction),
);
app.get(
    '/.ghost/activitypub/thread/:activity_id',
    spanWrapper(getActivityThreadAction),
);

/** Federation wire up */

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
