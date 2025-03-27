import { Temporal } from '@js-temporal/polyfill';
import { z } from 'zod';

import type { KnexAccountRepository } from '../../account/account.repository.knex';
import type { AppContext } from '../../app';
import { ACTOR_DEFAULT_HANDLE } from '../../constants';
import { Post } from '../../post/post.entity';
import type { KnexPostRepository } from '../../post/post.repository.knex';
import { publishPost } from '../../publishing/helpers';
import { PostVisibility } from '../../publishing/types';
import type { SiteService } from '../../site/site.service';

const PostInputSchema = z.object({
    uuid: z.string().uuid(),
    title: z.string(),
    html: z.string().nullable(),
    excerpt: z.string().nullable(),
    custom_excerpt: z.string().nullable(),
    feature_image: z.string().url().nullable(),
    published_at: z.string().datetime(),
    url: z.string().url(),
    visibility: z.nativeEnum(PostVisibility),
});

type PostInput = z.infer<typeof PostInputSchema>;

const PostPublishedWebhookSchema = z.object({
    post: z.object({
        current: PostInputSchema,
    }),
});

/**
 * Handle a post.published webhook
 *
 * @param ctx App context instance
 */
export function createPostPublishedWebhookHandler(
    accountRepository: KnexAccountRepository,
    postRepository: KnexPostRepository,
) {
    return async function handleWebhookPostPublished(ctx: AppContext) {
        let data: PostInput;

        try {
            data = PostPublishedWebhookSchema.parse(
                (await ctx.req.json()) as unknown,
            ).post.current;
        } catch (err) {
            return new Response(JSON.stringify({}), { status: 400 });
        }

        const account = await accountRepository.getBySite(ctx.get('site'));

        try {
            const post = Post.createArticleFromGhostPost(account, data);
            await postRepository.save(post);
        } catch (err) {
            ctx.get('logger').error('Failed to store post: {error}', {
                error: err,
            });
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
                visibility: data.visibility,
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
    };
}

/**
 * Handle a site.changed webhook
 *
 * @param ctx App context instance
 */
export const handleWebhookSiteChanged = (siteService: SiteService) =>
    async function handleWebhookSiteChanged(ctx: AppContext) {
        try {
            await siteService.refreshSiteDataForHost(ctx.get('site').host);
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
    };
