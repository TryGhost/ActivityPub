import { z } from 'zod';

import { exhaustiveCheck, getError, getValue, isError } from 'core/result';
import type { GhostPostService } from 'ghost/ghost-post.service';
import type { PostService } from 'post/post.service';
import type { AppContext } from '../../app';
import { postToDTO } from './helpers/post';
import { BadRequest, Forbidden } from './helpers/response';

const PostInputSchema = z.object({
    uuid: z.string().uuid(),
    title: z.string(),
    html: z.string().nullable(),
    excerpt: z.string().nullable(),
    custom_excerpt: z.string().nullable(),
    feature_image: z.string().url().nullable(),
    published_at: z.string().datetime(),
    url: z.string().url(),
    visibility: z.enum(['public', 'members', 'paid', 'tiers']),
    authors: z
        .array(
            z.object({
                name: z.string(),
                profile_image: z.string().nullable(),
            }),
        )
        .nullable()
        .optional(),
});

type PostInput = z.infer<typeof PostInputSchema>;

const PostPublishedWebhookSchema = z.object({
    post: z.object({
        current: PostInputSchema,
    }),
});

const PostDeletedWebhookSchema = z.object({
    post: z.object({
        previous: z.object({
            uuid: z.string().uuid(),
        }),
    }),
});

export class WebhookController {
    constructor(
        private readonly postService: PostService,
        private readonly ghostPostService: GhostPostService,
    ) {}

    /**
     * Handle a post.published webhook
     *
     * @param ctx App context instance
     */
    async handlePostPublished(ctx: AppContext) {
        let data: PostInput;

        try {
            data = PostPublishedWebhookSchema.parse(
                (await ctx.req.json()) as unknown,
            ).post.current;
        } catch (err) {
            if (err instanceof Error) {
                return BadRequest(`Could not parse payload: ${err.message}`);
            }
            return BadRequest('Could not parse payload');
        }

        const account = ctx.get('account');

        const postResult = await this.postService.handleIncomingGhostPost(
            account,
            data,
        );

        if (isError(postResult)) {
            const error = getError(postResult);
            switch (error) {
                case 'missing-content':
                    return BadRequest(
                        'Error creating post: the post has no content',
                    );
                case 'private-content':
                    return BadRequest(
                        'Error creating post: the post content is private',
                    );
                case 'post-already-exists':
                    return BadRequest(
                        'Webhook already processed for this post',
                    );
                default:
                    return exhaustiveCheck(error);
            }
        }

        const post = getValue(postResult);

        return new Response(JSON.stringify(postToDTO(post)), {
            headers: {
                'Content-Type': 'application/json',
            },
            status: 200,
        });
    }

    async handlePostUnpublished(ctx: AppContext) {
        return new Response(null, {
            status: 200,
        });
    }

    async handlePostUpdated(ctx: AppContext) {
        let data: PostInput;

        try {
            data = PostPublishedWebhookSchema.parse(
                (await ctx.req.json()) as unknown,
            ).post.current;
        } catch (err) {
            if (err instanceof Error) {
                return BadRequest(`Could not parse payload: ${err.message}`);
            }
            return BadRequest('Could not parse payload');
        }

        const account = ctx.get('account');

        await this.ghostPostService.updateArticleFromGhostPost(account, data);

        return new Response(null, {
            status: 200,
        });
    }

    async handlePostDeleted(ctx: AppContext) {
        let uuid: string;
        try {
            uuid = PostDeletedWebhookSchema.parse(
                (await ctx.req.json()) as unknown,
            ).post.previous.uuid;
        } catch (err) {
            if (err instanceof Error) {
                return BadRequest(`Could not parse payload: ${err.message}`);
            }
            return BadRequest('Could not parse payload');
        }

        const account = ctx.get('account');

        const deleteResult = await this.ghostPostService.deleteGhostPost(
            account,
            uuid,
        );

        if (isError(deleteResult)) {
            const error = getError(deleteResult);
            switch (error) {
                case 'upstream-error':
                case 'not-a-post':
                case 'missing-author':
                    return BadRequest('Failed to delete ghost post');
                case 'not-author':
                    return Forbidden(
                        `Failed to delete ghost post, ${account.name} is not the author of this post`,
                    );
                default:
                    return exhaustiveCheck(error);
            }
        }

        return new Response(null, {
            status: 200,
        });
    }
}
