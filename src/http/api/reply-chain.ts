import { exhaustiveCheck, getError, getValue, isError } from 'core/result';
import type { AppContext } from '../../app';
import { NotFound } from './helpers/response';
import type { ReplyChainView } from './views/reply.chain.view';

export class ReplyChainController {
    constructor(private readonly replyChainView: ReplyChainView) {}

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
