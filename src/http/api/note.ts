import { z } from 'zod';

import type { KnexAccountRepository } from '../../account/account.repository.knex';
import type { AppContext } from '../../app';
import { ACTOR_DEFAULT_HANDLE } from '../../constants';
import { publishNote } from '../../publishing/helpers';
import type { PublishResult } from '../../publishing/service';
import type { KnexPostRepository } from '../../post/post.repository.knex';
import { Post, PostType, Audience } from '../../post/post.entity';

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

    let result: PublishResult | null = null;

    try {
        result = await publishNote(ctx, {
            content: data.content,
            author: {
                handle: ACTOR_DEFAULT_HANDLE,
            },
        });
    } catch (err) {
        ctx.get('logger').error('Failed to publish note: {error}', {
            error: err,
        });
    }

    // Save to posts table when a note is created
    const account = await accountRepository.getBySite(ctx.get('site'));
    const post = new Post(
        null,
        null,
        account,
        PostType.Note,
        Audience.Public,
        null,
        null,
        data.content,
        new URL(account?.avatarUrl || ''),
        null,
        new Date(),
    );
    await postRepository.save(post);

    // Save to feeds table when a note is created

    return new Response(JSON.stringify(result ? result.activityJsonLd : {}), {
        headers: {
            'Content-Type': 'application/json',
        },
        status: 200,
    });
}
