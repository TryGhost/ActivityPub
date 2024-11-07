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
import { KnexKvStore } from './knex.kvstore';
import { scopeKvStore } from './kv-helpers';

import {
    followAction,
    inboxHandler,
    likeAction,
    postPublishedWebhook,
    replyAction,
    siteChangedWebhook,
    unlikeAction,
} from './handlers';

import { getTraceAndSpanId } from './helpers/context-header';
import { getRequestData } from './helpers/request-data';
import { spanWrapper } from './instrumentation';

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

export const fedify = createFederation<ContextData>({
    kv: fedifyKv,
    skipSignatureVerification:
        process.env.SKIP_SIGNATURE_VERIFICATION === 'true' &&
        process.env.NODE_ENV === 'testing',
    allowPrivateAddress:
        process.env.ALLOW_PRIVATE_ADDRESS === 'true' &&
        process.env.NODE_ENV === 'testing',
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
        if (!ctx.data.db) {
            ctx.data.db = scopeKvStore(db, ['sites', host]);
        }
        if (!ctx.data.logger) {
            ctx.data.logger = logging;
        }
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
    const extra: Record<string, string> = {};

    const { traceId, spanId } = getTraceAndSpanId(
        ctx.req.header('traceparent'),
    );
    if (traceId && spanId) {
        extra['logging.googleapis.com/trace'] =
            `projects/ghost-activitypub/traces/${traceId}`;
        extra['logging.googleapis.com/spanId'] = spanId;
    }

    ctx.set('logger', logging.with(extra));

    return Sentry.withIsolationScope((scope) => {
        scope.addEventProcessor((event) => {
            Sentry.addRequestDataToEvent(event, getRequestData(ctx.req.raw));
            return event;
        });

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

app.use(async (ctx, next) => {
    const request = ctx.req;
    const host = request.header('host');
    if (!host) {
        // TODO handle
        throw new Error('No Host header');
    }

    const scopedDb = scopeKvStore(db, ['sites', host]);

    const site = await getSite(host);

    if (!site) {
        return new Response(null, {
            status: 403,
        });
    }

    ctx.set('db', scopedDb);
    ctx.set('globaldb', db);
    ctx.set('site', site);

    await next();
});

app.use(async (ctx, next) => {
    const request = ctx.req;
    const host = request.header('host');
    if (!host) {
        // TODO handle
        throw new Error('No Host header');
    }
    ctx.set('role', GhostRole.Anonymous);

    const authorization = request.header('authorization');

    if (!authorization) {
        return next();
    }

    const [match, token] = authorization.match(/Bearer\s+(.*)$/) || [null];

    if (!match) {
        throw new Error('Invalid Authorization header');
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

    const jwksResponse = await fetch(jwksURL, {
        redirect: 'follow',
    });

    const jwks = await jwksResponse.json();

    const key = await jose.JWK.asKey(jwks.keys[0]);

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
