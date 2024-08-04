import { serve } from '@hono/node-server';
import {
    Article,
    Accept,
    Object as ActivityPubObject,
    createFederation,
    Follow,
    KvKey,
    KvStore,
    MemoryKvStore,
    Create,
    Note,
    Application,
    Group,
    Organization,
    Service,
    Update,
    Announce,
    Context,
} from '@fedify/fedify';
import { federation } from '@fedify/fedify/x/hono';
import { Hono, Context as HonoContext } from 'hono';
import { cors } from 'hono/cors';
import { behindProxy } from 'x-forwarded-fetch';
import { configure, getConsoleSink } from '@logtape/logtape';
import * as Sentry from '@sentry/node';
import { KnexKvStore } from './knex.kvstore';
import { client } from './db';
import { scopeKvStore } from './kv-helpers';
import {
    actorDispatcher,
    keypairDispatcher,
    handleFollow,
    inboxErrorHandler,
    handleAccept,
    handleCreate,
    followersDispatcher,
    followersCounter,
    followingDispatcher,
    followingCounter,
    outboxDispatcher,
    outboxCounter,
    articleDispatcher,
    noteDispatcher,
    followDispatcher,
    acceptDispatcher,
    createDispatcher,
    updateDispatcher,
    handleAnnounce,
} from './dispatchers';

import { followAction, inboxHandler, postPublishedWebhook, siteChangedWebhook } from './handlers';

if (process.env.SENTRY_DSN) {
    Sentry.init({ dsn: process.env.SENTRY_DSN });
}

await configure({
    sinks: { console: getConsoleSink() },
    filters: {},
    loggers: [{ category: 'fedify', sinks: ['console'], level: 'debug' }],
});

export type ContextData = {
    db: KvStore;
    globaldb: KvStore;
};

const fedifyKv = await KnexKvStore.create(client, 'key_value');

export const fedify = createFederation<ContextData>({
    kv: fedifyKv,
    skipSignatureVerification: process.env.SKIP_SIGNATURE_VERIFICATION === 'true' && process.env.NODE_ENV === 'testing',
});

export const db = await KnexKvStore.create(client, 'key_value');

/** Fedify */

/**
 * Fedify does not pass the correct context object when running outside of the request context
 * for example in the context of the Inbox Queue - so we need to wrap handlers with this.
 */
function ensureCorrectContext<B, R>(fn: (ctx: Context<ContextData>, b: B) => Promise<R>) {
    return async function (ctx: Context<any>, b: B) {
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
        return fn(ctx, b);
    }
}

fedify
    // actorDispatcher uses RequestContext so doesn't need the ensureCorrectContext wrapper
    .setActorDispatcher('/.ghost/activitypub/users/{handle}', actorDispatcher)
    .setKeyPairsDispatcher(ensureCorrectContext(keypairDispatcher));

const inboxListener = fedify.setInboxListeners(
    '/.ghost/activitypub/inbox/{handle}',
    '/.ghost/activitypub/inbox',
);

inboxListener
    .on(Follow, ensureCorrectContext(handleFollow))
    .onError(inboxErrorHandler)
    .on(Accept, ensureCorrectContext(handleAccept))
    .onError(inboxErrorHandler)
    .on(Create, ensureCorrectContext(handleCreate))
    .onError(inboxErrorHandler)
    .on(Announce, ensureCorrectContext(handleAnnounce))
    .onError(inboxErrorHandler);

fedify
    .setFollowersDispatcher(
        '/.ghost/activitypub/followers/{handle}',
        followersDispatcher,
    )
    .setCounter(followersCounter);

fedify
    .setFollowingDispatcher(
        '/.ghost/activitypub/following/{handle}',
        followingDispatcher,
    )
    .setCounter(followingCounter);

fedify
    .setOutboxDispatcher(
        '/.ghost/activitypub/outbox/{handle}',
        outboxDispatcher,
    )
    .setCounter(outboxCounter);

fedify.setObjectDispatcher(
    Article,
    `/.ghost/activitypub/article/{id}`,
    articleDispatcher,
);
fedify.setObjectDispatcher(
    Note,
    `/.ghost/activitypub/note/{id}`,
    noteDispatcher,
);
fedify.setObjectDispatcher(
    Follow,
    `/.ghost/activitypub/follow/{id}`,
    followDispatcher,
);
fedify.setObjectDispatcher(
    Accept,
    `/.ghost/activitypub/accept/{id}`,
    acceptDispatcher,
);
fedify.setObjectDispatcher(
    Create,
    `/.ghost/activitypub/create/{id}`,
    createDispatcher,
);
fedify.setObjectDispatcher(
    Update,
    `/.ghost/activitypub/update/{id}`,
    updateDispatcher,
);

/** Hono */

export type HonoContextVariables = {
    db: KvStore;
    globaldb: KvStore;
};

const app = new Hono<{ Variables: HonoContextVariables }>();

/** Middleware */

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
    console.log(
        `${ctx.req.method.toUpperCase()} ${ctx.req.header('host')} ${ctx.req.url}          ${id}b`,
    );
    await next();
    const end = Date.now();
    console.log(
        `${ctx.req.method.toUpperCase()} ${ctx.req.header('host')} ${ctx.req.url} ${ctx.res.status} ${end - start}ms ${id}`,
    );
});

app.use(async (ctx, next) => {
    const request = ctx.req;
    const host = request.header('host');
    if (!host) {
        // TODO handle
        throw new Error('No Host header');
    }

    const scopedDb = scopeKvStore(db, ['sites', host]);

    ctx.set('db', scopedDb);
    ctx.set('globaldb', db);

    await next();
});

/** Custom API routes */

app.get('/ping', (ctx) => {
    return new Response('', {
        status: 200
    });
});

app.get('/.ghost/activitypub/inbox/:handle', inboxHandler);
app.post('/.ghost/activitypub/webhooks/post/published', postPublishedWebhook);
app.post('/.ghost/activitypub/webhooks/site/changed', siteChangedWebhook);
app.post('/.ghost/activitypub/actions/follow/:handle', followAction);

/** Federation wire up */

app.use(
    federation(
        fedify,
        (ctx: HonoContext<{ Variables: HonoContextVariables }>): ContextData => {
            return {
                db: ctx.get('db'),
                globaldb: ctx.get('globaldb'),
            };
        },
    ),
);

function forceAcceptHeader(fn: (req: Request) => unknown) {
    return function (request: Request) {
        request.headers.set('accept', 'application/activity+json');
        return fn(request);
    };
}

serve(
    {
        fetch: forceAcceptHeader(behindProxy(app.fetch)),
        port: parseInt(process.env.PORT || '8080'),
    },
    function (info) {
        console.log(`listening on ${info.address}:${info.port}`);
    },
);

process.on('SIGINT', () => process.exit(0));
