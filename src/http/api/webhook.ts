import { z } from 'zod';

import { exhaustiveCheck, getError, getValue, isError } from 'core/result';
import type { KnexAccountRepository } from '../../account/account.repository.knex';
import type { AppContext } from '../../app';
import { Post } from '../../post/post.entity';
import type { KnexPostRepository } from '../../post/post.repository.knex';
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
            if (err instanceof Error) {
                return BadRequest(`Could not parse payload: ${err.message}`);
            }
            return BadRequest('Could not parse payload');
        }

        const account = await accountRepository.getBySite(ctx.get('site'));

        const postResult = await Post.createArticleFromGhostPost(account, data);

        if (isError(postResult)) {
            const error = getError(postResult);
            switch (error) {
                case 'private-content':
                    return BadRequest(
                        'Cannot create Post from private content',
                    );
                default:
                    return exhaustiveCheck(error);
            }
        }
        const post = getValue(postResult);

        await postRepository.save(post);

        return new Response(JSON.stringify(postToDTO(post)), {
            headers: {
                'Content-Type': 'application/json',
            },
            status: 200,
        });
    };
}
