import { z } from 'zod';

import type { AppContext } from 'app';
import { exhaustiveCheck, getError, getValue, isError } from 'core/result';
import type { PostService } from 'post/post.service';
import { postToDTO } from './helpers/post';

const NoteSchema = z.object({
    content: z.string(),
    imageUrl: z.string().url().optional(),
});

export async function handleCreateNote(
    ctx: AppContext,
    postService: PostService,
) {
    let data: z.infer<typeof NoteSchema>;

    try {
        data = NoteSchema.parse((await ctx.req.json()) as unknown);
    } catch (err) {
        return new Response(
            JSON.stringify({ error: 'Invalid request format' }),
            { status: 400 },
        );
    }

    const postResult = await postService.createNote(
        ctx.get('account'),
        data.content,
        data.imageUrl ? new URL(data.imageUrl) : undefined,
    );

    if (isError(postResult)) {
        const error = getError(postResult);
        let errorMessage = 'Error verifying image URL';
        switch (error) {
            case 'invalid-url':
                errorMessage = 'Invalid image URL format';
                break;
            case 'invalid-file-path':
                errorMessage = 'Invalid image file path';
                break;
            case 'file-not-found':
                errorMessage = 'Image not found in storage';
                break;
            case 'gcs-error':
                ctx.get('logger').error('GCS error verifying image URL', {
                    url: data.imageUrl,
                });
                break;
            default:
                return exhaustiveCheck(error);
        }

        return new Response(JSON.stringify({ error: errorMessage }), {
            status: 400,
        });
    }

    const post = getValue(postResult);

    const postDTO = postToDTO(post, {
        authoredByMe: true,
        likedByMe: false,
        repostedByMe: false,
        repostedBy: null,
    });

    return new Response(JSON.stringify({ post: postDTO }), {
        headers: {
            'Content-Type': 'application/json',
        },
        status: 200,
    });
}
