import { z } from 'zod';

import type { KnexAccountRepository } from '../../account/account.repository.knex';
import type { AppContext } from '../../app';
import { ACTOR_DEFAULT_HANDLE } from '../../constants';
import { Post } from '../../post/post.entity';
import type { KnexPostRepository } from '../../post/post.repository.knex';
import { publishNote } from '../../publishing/helpers';
import type { PublishResult } from '../../publishing/service';

const NoteSchema = z.object({
    content: z.string(),
});

export async function handleCreateNote(
    ctx: AppContext,
    accountRepository: KnexAccountRepository,
    postRepository: KnexPostRepository,
) {
    let data: z.infer<typeof NoteSchema>;

    try {
        data = NoteSchema.parse((await ctx.req.json()) as unknown);
    } catch (err) {
        return new Response(JSON.stringify({}), { status: 400 });
    }

    // Save to posts table when a note is created
    const account = await accountRepository.getBySite(ctx.get('site'));
    const post = Post.createNote(account, data.content);
    await postRepository.save(post);

    let result: PublishResult | null = null;

    try {
        result = await publishNote(ctx, {
            content: post.content ?? '',
            author: {
                handle: ACTOR_DEFAULT_HANDLE,
            },
            apId: post.apId,
        });
    } catch (err) {
        ctx.get('logger').error('Failed to publish note: {error}', {
            error: err,
        });
    }

    return new Response(JSON.stringify(result ? result.activityJsonLd : {}), {
        headers: {
            'Content-Type': 'application/json',
        },
        status: 200,
    });
}
