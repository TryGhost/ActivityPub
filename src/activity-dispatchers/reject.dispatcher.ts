import { Reject, type RequestContext } from '@fedify/fedify';

import type { ContextData } from '@/app';

export async function dispatchRejectActivity(
    ctx: RequestContext<ContextData>,
    data: Record<'id', string>,
) {
    const id = ctx.getObjectUri(Reject, data);
    const exists = await ctx.data.globaldb.get([id.href]);
    if (!exists) {
        return null;
    }
    return Reject.fromJsonLd(exists);
}
