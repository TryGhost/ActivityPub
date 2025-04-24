import { z } from 'zod';

import type { KnexAccountRepository } from 'account/account.repository.knex';
import type { AppContext } from 'app';
import { exhaustiveCheck, getError, isError } from 'core/result';
import { Post } from 'post/post.entity';
import type { KnexPostRepository } from 'post/post.repository.knex';
import { publishNote } from 'publishing/helpers';
import type { ActivityJsonLd } from 'publishing/service';
import type { GCPStorageService } from 'storage/gcloud-storage/gcp-storage.service';
import { ACTOR_DEFAULT_HANDLE } from '../../constants';

const NoteSchema = z.object({
    content: z.string(),
    imageUrl: z.string().url().optional(),
});

export async function handleCreateNote(
    ctx: AppContext,
    accountRepository: KnexAccountRepository,
    postRepository: KnexPostRepository,
    storageService: GCPStorageService,
) {
    let data: z.infer<typeof NoteSchema>;

    try {
        data = NoteSchema.parse((await ctx.req.json()) as unknown);
    } catch (err) {
        return new Response(JSON.stringify({}), { status: 400 });
    }

    // Verify image URL if provided
    if (data.imageUrl) {
        const result = await storageService.verifyImageUrl(data.imageUrl);
        if (isError(result)) {
            const error = getError(result);
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
    }

    // Save to posts table when a note is created
    const account = await accountRepository.getBySite(ctx.get('site'));
    const post = Post.createNote(
        account,
        data.content,
        data.imageUrl ? new URL(data.imageUrl) : undefined,
    );
    await postRepository.save(post);

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
