import {
    Article,
    Follow,
    RequestContext,
    lookupObject,
    isActor,
    Create,
    Note,
} from '@fedify/fedify';
import { Context, Next } from 'hono';
import ky from 'ky';
import { v4 as uuidv4 } from 'uuid';
import { addToList } from './kv-helpers';
import { toURL } from './toURL';
import { ContextData, HonoContextVariables, fedify } from './app';
import type { PersonData } from './user';

type GhostSiteSettings = {
    site: {
        description: string;
        icon: string;
        title: string;
    }
}

async function postToArticle(ctx: RequestContext<ContextData>, post: any) {
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
        published: post.published_at,
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
    next: Next,
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
    next: Next,
) {
    try {
        // Retrieve site settings from Ghost
        const host = ctx.req.header('host');

        const settings = await ky
            .get(`https://${host}/ghost/api/admin/site/`)
            .json<GhostSiteSettings>();

        // Update the database
        const handle = 'index';
        const db = ctx.get('db');

        const current = await db.get<PersonData>(['handle', handle]);

        await db.set(['handle', handle], {
            ...current,
            icon: settings.site.icon,
            name: settings.site.title,
            summary: settings.site.description,
        });
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
    next: Next,
) {
    const results = (await ctx.get('db').get<string[]>(['inbox'])) || [];
    let items: unknown[] = [];
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
