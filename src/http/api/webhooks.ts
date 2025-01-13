import { Temporal } from '@js-temporal/polyfill';
import { z } from 'zod';

import { type AppContext, fedify } from '../../app';
import { ACTOR_DEFAULT_HANDLE } from '../../constants';
import { updateSiteActor } from '../../helpers/activitypub/actor';
import { getSiteSettings } from '../../helpers/ghost';
import { publishPost } from '../../publishing/helpers';

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

const PostPublishedWebhookSchema = z.object({
    post: z.object({
        current: PostSchema,
    }),
});

/**
 * Handle a post.published webhook
 *
 * @param ctx App context instance
 */
export async function handleWebhookPostPublished(ctx: AppContext) {
    let data: Post;

    try {
        data = PostPublishedWebhookSchema.parse(
            (await ctx.req.json()) as unknown,
        ).post.current;
    } catch (err) {
        return new Response(JSON.stringify({}), { status: 400 });
    }

    try {
        await publishPost(ctx, {
            id: data.uuid,
            title: data.title,
            content: data.html,
            excerpt: data.excerpt,
            featureImageUrl: data.feature_image
                ? new URL(data.feature_image)
                : null,
            publishedAt: Temporal.Instant.from(data.published_at),
            url: new URL(data.url),
            author: {
                handle: ACTOR_DEFAULT_HANDLE,
            },
        });
    } catch (err) {
        ctx.get('logger').error('Failed to publish post: {error}', {
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

/**
 * Handle a site.changed webhook
 *
 * @param ctx App context instance
 */
export async function handleWebhookSiteChanged(ctx: AppContext) {
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
