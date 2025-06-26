import { z } from 'zod';

import type { AppContext } from 'app';
import { exhaustiveCheck, getError, getValue, isError } from 'core/result';
import type { ImageAttachment } from 'post/post.entity';
import type { PostService } from 'post/post.service';
import { postToDTO } from './helpers/post';

const NoteSchema = z.object({
    content: z.string(),
    image: z
        .object({
            url: z.string().url(),
            altText: z.string().optional(),
        })
        .optional(),
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

    let imageUrl: URL | undefined;

    if (data.imageUrl) {
        imageUrl = new URL(data.imageUrl);
    } else if (data.image) {
        imageUrl = new URL(data.image.url);
    }

    const image: ImageAttachment | undefined = imageUrl
        ? {
              url: imageUrl,
              altText: data.image?.altText ?? undefined,
          }
        : undefined;

    const postResult = await postService.createNote(
        ctx.get('account'),
        data.content,
        image,
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
        followingAuthor: false,
        followingReposter: false,
    });

    return new Response(JSON.stringify({ post: postDTO }), {
        headers: {
            'Content-Type': 'application/json',
        },
        status: 200,
    });
}
