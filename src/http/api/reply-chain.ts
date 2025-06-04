import type { AppContext } from '../../app';
import { ReplyChainView } from './views/reply.chain.view';

export class ReplyChainController {
    constructor(private readonly replyChainView: ReplyChainView) {}

    async handleGetReplies(ctx: AppContext) {
        const account = ctx.get('account');

        const replyChain = await this.replyChainView.getReplyChain(
            account.id,
            new URL(ctx.req.param('post_ap_id')),
        );

        return new Response(JSON.stringify(replyChain), { status: 200 });
    }
}
