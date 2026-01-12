import { Delete, type RequestContext } from '@fedify/fedify';

import type { FedifyContextData } from '@/app';

export class DeleteDispatcher {
    async dispatch(
        ctx: RequestContext<FedifyContextData>,
        data: Record<'id', string>,
    ) {
        const id = ctx.getObjectUri(Delete, data);
        const exists = await ctx.data.globaldb.get([id.href]);
        if (!exists) {
            return null;
        }
        return Delete.fromJsonLd(exists);
    }
}
