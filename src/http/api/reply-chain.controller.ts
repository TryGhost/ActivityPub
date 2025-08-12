import type { AppContext } from '@/app';
import { exhaustiveCheck, getError, getValue, isError } from '@/core/result';
import { NotFound } from '@/http/api/helpers/response';
import type { ReplyChainView } from '@/http/api/views/reply.chain.view';
import { APIRoute, RequireRoles } from '@/http/decorators/route.decorator';
import { GhostRole } from '@/http/middleware/role-guard';

export class ReplyChainController {
    constructor(private readonly replyChainView: ReplyChainView) {}

    @APIRoute('GET', 'replies/:post_ap_id')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
    async handleGetReplies(ctx: AppContext) {
        const account = ctx.get('account');

        const replyChainResult = await this.replyChainView.getReplyChain(
            account.id,
            new URL(ctx.req.param('post_ap_id')),
            ctx.req.query('next'),
        );

        if (isError(replyChainResult)) {
            const error = getError(replyChainResult);
            switch (error) {
                case 'not-found':
                    return NotFound('Post not found');
                default:
                    return exhaustiveCheck(error);
            }
        }

        return new Response(JSON.stringify(getValue(replyChainResult)), {
            status: 200,
        });
    }
}
