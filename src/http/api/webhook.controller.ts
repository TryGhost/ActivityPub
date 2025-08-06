import type { Logger } from '@logtape/logtape';
import { z } from 'zod';

import type { Account } from 'account/account.entity';
import { exhaustiveCheck, getError, getValue, isError } from 'core/result';
import type { GhostPostService } from 'ghost/ghost-post.service';
import type { PostService } from 'post/post.service';
import type { AppContext } from '../../app';
import { postDTOToV1, postToDTO } from './helpers/post';
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

const PostUnpublishedWebhookSchema = z.object({
    post: z.object({
        current: z.object({
            uuid: z.string().uuid(),
        }),
    }),
});

export class WebhookController {
    constructor(
        private readonly postService: PostService,
        private readonly ghostPostService: GhostPostService,
        private readonly logger: Logger,
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

        const postResult = await this.ghostPostService.createGhostPost(
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
                case 'failed-to-create-post':
                    return new Response('Failed to create post', {
                        status: 500,
                    });
                default:
                    return exhaustiveCheck(error);
            }
        }

        const post = getValue(postResult);
        const postDTO = postToDTO(post);

        return new Response(JSON.stringify(postDTOToV1(postDTO)), {
            headers: {
                'Content-Type': 'application/json',
            },
            status: 200,
        });
    }

    async handlePostUnpublished(ctx: AppContext) {
        let uuid: string;
        try {
            uuid = PostUnpublishedWebhookSchema.parse(
                (await ctx.req.json()) as unknown,
            ).post.current.uuid;
        } catch (err) {
            if (err instanceof Error) {
                return BadRequest(`Could not parse payload: ${err.message}`);
            }
            return BadRequest('Could not parse payload');
        }

        return this.deletePost(ctx.get('account'), uuid);
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

        return this.deletePost(ctx.get('account'), uuid);
    }

    private async deletePost(account: Account, uuid: string) {
        const deleteResult = await this.ghostPostService.deleteGhostPost(
            account,
            uuid,
        );

        if (isError(deleteResult)) {
            const error = getError(deleteResult);
            this.logger.error(
                'Failed to delete post with uuid: {uuid}, error: {error}',
                { uuid, error: error },
            );
            switch (error) {
                case 'upstream-error':
                case 'not-a-post':
                case 'missing-author':
                case 'post-not-found':
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
