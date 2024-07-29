import {
    Article,
    Follow,
    RequestContext,
    lookupObject,
    isActor,
    Create,
    Note,
    Update,
    PUBLIC_COLLECTION
} from '@fedify/fedify';
import { Context } from 'hono';
import ky from 'ky';
import { v4 as uuidv4 } from 'uuid';
import { addToList } from './kv-helpers';
import { toURL } from './toURL';
import { ContextData, HonoContextVariables, fedify } from './app';
import type { PersonData } from './user';
import {
    ACTOR_DEFAULT_HANDLE,
    ACTOR_DEFAULT_ICON,
    ACTOR_DEFAULT_NAME,
    ACTOR_DEFAULT_SUMMARY
} from './constants';

type GhostSiteSettings = {
    site: {
        description: string;
        icon: string;
        title: string;
    }
}

type Post = {
    uuid: string;
    excerpt: string;
    title: string;
    html: string;
    feature_image: string;
    published_at: string;
    url: string;
}

async function getGhostSiteSettings(host: string): Promise<GhostSiteSettings> {
    const settings = await ky
        .get(`https://${host}/ghost/api/admin/site/`)
        .json<Partial<GhostSiteSettings>>();

    return {
        site: {
            description: settings?.site?.description || ACTOR_DEFAULT_SUMMARY,
            title: settings?.site?.title || ACTOR_DEFAULT_NAME,
            icon: settings?.site?.icon || ACTOR_DEFAULT_ICON
        }
    };
}

async function postToArticle(ctx: RequestContext<ContextData>, post: Post) {
    if (!post) {
        return {
            article: null,
            preview: null,
        };
    }
    const preview = new Note({
        id: ctx.getObjectUri(Note, { id: post.uuid }),
        content: post.excerpt,
    });
    const article = new Article({
        id: ctx.getObjectUri(Article, { id: post.uuid }),
        name: post.title,
        content: post.html,
        image: toURL(post.feature_image),
        published: post.published_at as any, /* eslint-disable-line @typescript-eslint/no-explicit-any */
        preview: preview,
        url: toURL(post.url),
    });

    return {
        article,
        preview,
    };
}

export async function followAction(
    ctx: Context<{ Variables: HonoContextVariables }>,
) {
    const handle = ctx.req.param('handle');
    const actorToFollow = await lookupObject(handle);
    if (!isActor(actorToFollow)) {
        // Not Found?
        return;
    }
    const apCtx = fedify.createContext(ctx.req.raw as Request, {
        db: ctx.get('db'),
        globaldb: ctx.get('globaldb'),
    });
    const actor = await apCtx.getActor('index'); // TODO This should be the actor making the request
    const followId = apCtx.getObjectUri(Follow, {
        id: uuidv4(),
    });
    const follow = new Follow({
        id: followId,
        actor: actor,
        object: actorToFollow,
    });
    const followJson = await follow.toJsonLd();
    ctx.get('globaldb').set([follow.id!.href], followJson);

    apCtx.sendActivity({ handle: 'index' }, actorToFollow, follow);
    return new Response(JSON.stringify(followJson), {
        headers: {
            'Content-Type': 'application/activity+json',
        },
        status: 200,
    });
}

export async function postPublishedWebhook(
    ctx: Context<{ Variables: HonoContextVariables }>,
) {
    // TODO: Validate webhook with secret
    const data = await ctx.req.json();
    const apCtx = fedify.createContext(ctx.req.raw as Request, {
        db: ctx.get('db'),
        globaldb: ctx.get('globaldb'),
    });
    const { article, preview } = await postToArticle(
        apCtx,
        data?.post?.current,
    );
    if (article) {
        const actor = await apCtx.getActor('index');
        const create = new Create({
            actor,
            object: article,
            id: apCtx.getObjectUri(Create, { id: uuidv4() }),
            to: apCtx.getFollowersUri('index'),
        });
        try {
            await article.toJsonLd();
            await ctx
                .get('globaldb')
                .set([preview.id!.href], await preview.toJsonLd());
            await ctx
                .get('globaldb')
                .set([create.id!.href], await create.toJsonLd());
            await ctx
                .get('globaldb')
                .set([article.id!.href], await article.toJsonLd());
            await addToList(ctx.get('db'), ['outbox'], create.id!.href);
            await apCtx.sendActivity({ handle: 'index' }, 'followers', create);
        } catch (err) {
            console.log(err);
        }
    }
    return new Response(JSON.stringify({}), {
        headers: {
            'Content-Type': 'application/activity+json',
        },
        status: 200,
    });
}

export async function siteChangedWebhook(
    ctx: Context<{ Variables: HonoContextVariables }>,
) {
    try {
        // Retrieve site settings from Ghost
        const host = ctx.req.header('host') || '';

        const settings = await getGhostSiteSettings(host);

        // Update the database
        const handle = ACTOR_DEFAULT_HANDLE;
        const db = ctx.get('db');

        const current = await db.get<PersonData>(['handle', handle]);
        const updated =  {
            ...current,
            icon: settings.site.icon,
            name: settings.site.title,
            summary: settings.site.description,
        }

        await db.set(['handle', handle], updated);

        // Publish activity
        const apCtx = fedify.createContext(ctx.req.raw as Request, {
            db,
            globaldb: ctx.get('globaldb'),
        });

        const actor = await apCtx.getActor(handle);

        const update = new Update({
            id: apCtx.getObjectUri(Update, { id: uuidv4() }),
            actor: actor?.id,
            to: PUBLIC_COLLECTION,
            object: actor
        });

        await ctx.get('globaldb').set([update.id!.href], await update.toJsonLd());
        await addToList(db, ['outbox'], update.id!.href);
        await apCtx.sendActivity({ handle }, 'followers', update);
    } catch (err) {
        console.log(err);
    }

    // Return 200 OK
    return new Response(JSON.stringify({}), {
        headers: {
            'Content-Type': 'application/activity+json',
        },
        status: 200,
    });
}

export async function inboxHandler(
    ctx: Context<{ Variables: HonoContextVariables }>,
) {
    const results = (await ctx.get('db').get<string[]>(['inbox'])) || [];
    const items: unknown[] = [];
    for (const result of results) {
        try {
            const thing = await ctx.get('globaldb').get([result]);
            items.push(thing);
        } catch (err) {
            console.log(err);
        }
    }
    return new Response(
        JSON.stringify({
            '@context': 'https://www.w3.org/ns/activitystreams',
            type: 'OrderedCollection',
            totalItems: results.length,
            items,
        }),
        {
            headers: {
                'Content-Type': 'application/activity+json',
            },
            status: 200,
        },
    );
}
