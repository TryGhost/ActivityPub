import { Reject } from '@fedify/fedify';

import type { FedifyRequestContext } from '@/app';

export async function dispatchRejectActivity(
    ctx: FedifyRequestContext,
    data: Record<'id', string>,
) {
    const id = ctx.getObjectUri(Reject, data);
    const exists = await ctx.data.globaldb.get([id.href]);
    if (!exists) {
        return null;
    }
    return Reject.fromJsonLd(exists);
}
