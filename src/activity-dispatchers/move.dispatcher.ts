import { Move } from '@fedify/vocab';

import type { FedifyRequestContext } from '@/app';

export async function dispatchMoveActivity(
    ctx: FedifyRequestContext,
    data: Record<'id', string>,
) {
    const id = ctx.getObjectUri(Move, data);
    const activity = await ctx.data.globaldb.get([id.href]);
    return activity ? Move.fromJsonLd(activity) : null;
}
