import z from 'zod';

import type { AppContext } from 'app';
import { getValue } from 'core/result';
import { exhaustiveCheck, getError, isError } from 'core/result';
import { parseURL } from 'core/url';
import type { PostService } from 'post/post.service';
import { postToDTO } from './helpers/post';

const ReplyActionSchema = z.object({
    content: z.string(),
    imageUrl: z.string().url().optional(),
});

export async function handleCreateReply(
    ctx: AppContext,
    postService: PostService,
) {
    const id = ctx.req.param('id');

    let data: z.infer<typeof ReplyActionSchema>;

    try {
        data = ReplyActionSchema.parse((await ctx.req.json()) as unknown);
    } catch (err) {
        return new Response(
            JSON.stringify({ error: 'Invalid request format' }),
            { status: 400 },
        );
    }

    const inReplyToId = parseURL(decodeURIComponent(id));

    if (!inReplyToId) {
        return new Response(
            JSON.stringify({ error: 'ID should be a valid URL' }),
            {
                status: 400,
            },
        );
    }

    const newReplyResult = await postService.createReply(
        ctx.get('account'),
        data.content,
        inReplyToId,
        data.imageUrl ? new URL(data.imageUrl) : undefined,
    );

    if (isError(newReplyResult)) {
        const error = getError(newReplyResult);
        switch (error) {
            case 'upstream-error':
                ctx.get('logger').info(
                    'Upstream error fetching parent post for reply',
                    {
                        postId: inReplyToId.href,
                    },
                );
                return new Response(
                    JSON.stringify({
                        error: 'Invalid Reply - upstream error fetching parent post',
                    }),
                    {
                        status: 404,
                    },
                );
            case 'not-a-post':
                ctx.get('logger').info(
                    'Parent resource for reply is not a post',
                    {
                        postId: inReplyToId.href,
                    },
                );
                return new Response(
                    JSON.stringify({
                        error: 'Invalid Reply - parent is not a post',
                    }),
                    {
                        status: 404,
                    },
                );
            case 'missing-author':
                ctx.get('logger').info(
                    'Parent post for reply has missing author',
                    {
                        postId: inReplyToId.href,
                    },
                );
                return new Response(
                    JSON.stringify({
                        error: 'Invalid Reply - parent post has no author',
                    }),
                    {
                        status: 404,
                    },
                );
            case 'invalid-url':
                return new Response(
                    JSON.stringify({ error: 'Invalid image URL format' }),
                    {
                        status: 400,
                    },
                );
            case 'invalid-file-path':
                return new Response(
                    JSON.stringify({ error: 'Invalid image file path' }),
                    {
                        status: 400,
                    },
                );
            case 'file-not-found':
                return new Response(
                    JSON.stringify({ error: 'Image not found in storage' }),
                    {
                        status: 400,
                    },
                );
            case 'gcs-error':
                ctx.get('logger').error('GCS error verifying image URL', {
                    url: data.imageUrl,
                });
                return new Response(
                    JSON.stringify({ error: 'Error verifying image URL' }),
                    {
                        status: 400,
                    },
                );
            case 'cannot-interact':
                return new Response(
                    JSON.stringify({
                        error: 'Cannot interact with this account',
                    }),
                    {
                        status: 403,
                    },
                );
            default:
                return exhaustiveCheck(error);
        }
    }

    const newReply = getValue(newReplyResult);

    const replyDTO = postToDTO(newReply, {
        authoredByMe: newReply.author.id === ctx.get('account').id,
        likedByMe: false,
        repostedByMe: false,
        repostedBy: null,
    });

    return new Response(JSON.stringify({ reply: replyDTO }), {
        headers: {
            'Content-Type': 'application/json',
        },
        status: 200,
    });
}
