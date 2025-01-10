import {
    type Actor,
    Article,
    Create,
    Note,
    PUBLIC_COLLECTION,
    type RequestContext,
} from '@fedify/fedify';
import { Temporal } from '@js-temporal/polyfill';
import type { Context } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

import { type ContextData, type HonoContextVariables, fedify } from '../../app';
import { ACTOR_DEFAULT_HANDLE } from '../../constants';
import { updateSiteActor } from '../../helpers/activitypub/actor';
import { getSiteSettings } from '../../helpers/ghost';
import { toURL } from '../../helpers/uri';
import { addToList } from '../../kv-helpers';

const PostSchema = z.object({
    uuid: z.string().uuid(),
    title: z.string(),
    html: z.string().nullable(),
    excerpt: z.string().nullable(),
    feature_image: z.string().url().nullable(),
    published_at: z.string().datetime(),
    url: z.string().url(),
});

type Post = z.infer<typeof PostSchema>;

async function postToArticle(
    ctx: RequestContext<ContextData>,
    post: Post,
    author: Actor | null,
) {
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
        attribution: author,
        name: post.title,
        content: post.html,
        image: toURL(post.feature_image),
        published: Temporal.Instant.from(post.published_at),
        preview: preview,
        url: toURL(post.url),
        to: PUBLIC_COLLECTION,
        cc: ctx.getFollowersUri(ACTOR_DEFAULT_HANDLE),
    });

    return {
        article,
        preview,
    };
}

const PostPublishedWebhookSchema = z.object({
    post: z.object({
        current: PostSchema,
    }),
});

/**
 * Handle a post.published webhook
 *
 * @param ctx {Context<{ Variables: HonoContextVariables }>} Hono context instance
 */
export async function handleWebhookPostPublished(
    ctx: Context<{ Variables: HonoContextVariables }>,
) {
    const data = PostPublishedWebhookSchema.parse(
        (await ctx.req.json()) as unknown,
    );
    const apCtx = fedify.createContext(ctx.req.raw as Request, {
        db: ctx.get('db'),
        globaldb: ctx.get('globaldb'),
        logger: ctx.get('logger'),
    });
    const actor = await apCtx.getActor(ACTOR_DEFAULT_HANDLE);
    const { article, preview } = await postToArticle(
        apCtx,
        data.post.current,
        actor,
    );
    if (article) {
        const create = new Create({
            actor,
            object: article,
            id: apCtx.getObjectUri(Create, { id: uuidv4() }),
            to: PUBLIC_COLLECTION,
            cc: apCtx.getFollowersUri('index'),
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
            await apCtx.sendActivity(
                { handle: ACTOR_DEFAULT_HANDLE },
                'followers',
                create,
                {
                    preferSharedInbox: true,
                },
            );
        } catch (err) {
            ctx.get('logger').error('Post published webhook failed: {error}', {
                error: err,
            });
        }
    }
    return new Response(JSON.stringify({}), {
        headers: {
            'Content-Type': 'application/json',
        },
        status: 200,
    });
}

/**
 * Handle a site.changed webhook
 *
 * @param ctx {Context<{ Variables: HonoContextVariables }>} Hono context instance
 */
export async function handleWebhookSiteChanged(
    ctx: Context<{ Variables: HonoContextVariables }>,
) {
    try {
        const db = ctx.get('db');
        const globaldb = ctx.get('globaldb');
        const logger = ctx.get('logger');

        const apCtx = fedify.createContext(ctx.req.raw as Request, {
            db,
            globaldb,
            logger,
        });

        await updateSiteActor(apCtx, getSiteSettings);
    } catch (err) {
        ctx.get('logger').error('Site changed webhook failed: {error}', {
            error: err,
        });
    }

    return new Response(JSON.stringify({}), {
        headers: {
            'Content-Type': 'application/json',
        },
        status: 200,
    });
}
