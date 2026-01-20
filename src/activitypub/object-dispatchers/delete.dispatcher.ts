import { Delete } from '@fedify/fedify';

import type { FedifyRequestContext } from '@/app';

export class DeleteDispatcher {
    async dispatch(ctx: FedifyRequestContext, data: Record<'id', string>) {
        const id = ctx.getObjectUri(Delete, data);
        const exists = await ctx.data.globaldb.get([id.href]);
        if (!exists) {
            return null;
        }
        return Delete.fromJsonLd(exists);
    }
}
