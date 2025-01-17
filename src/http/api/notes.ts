import { z } from 'zod';

import type { AppContext } from '../../app';
import { ACTOR_DEFAULT_HANDLE } from '../../constants';
import { publishNote } from '../../publishing/helpers';
import type { PublishResult } from '../../publishing/service';

const NoteSchema = z.object({
    content: z.string(),
});

export async function handleCreateNote(ctx: AppContext) {
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

    return new Response(JSON.stringify(result ? result.activityJsonLd : {}), {
        headers: {
            'Content-Type': 'application/json',
        },
        status: 200,
    });
}
