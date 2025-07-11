import { z } from 'zod';

import { exhaustiveCheck, getError, getValue, isError } from 'core/result';
import type { PostService } from 'post/post.service';
import type { AppContext } from '../../app';
import { postToDTO } from './helpers/post';
import { BadRequest } from './helpers/response';

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

export class WebhookController {
    constructor(private readonly postService: PostService) {}

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
}
