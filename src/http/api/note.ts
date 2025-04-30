import { z } from 'zod';

import type { AppContext } from 'app';
import { exhaustiveCheck, getError, getValue, isError } from 'core/result';
import type { PostService } from 'post/post.service';
import { publishNote } from 'publishing/helpers';
import type { ActivityJsonLd } from 'publishing/service';
import { ACTOR_DEFAULT_HANDLE } from '../../constants';

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
        return new Response(JSON.stringify({}), { status: 400 });
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

    let result: ActivityJsonLd | null = null;

    try {
        result = await publishNote(ctx, {
            content: post.content ?? '',
            author: {
                handle: ACTOR_DEFAULT_HANDLE,
            },
            apId: post.apId,
            imageUrl: post.imageUrl,
        });
    } catch (err) {
        ctx.get('logger').error('Failed to publish note: {error}', {
            error: err,
        });
    }

    return new Response(JSON.stringify(result || {}), {
        headers: {
            'Content-Type': 'application/json',
        },
        status: 200,
    });
}
