import { exhaustiveCheck, getError, getValue, isError } from 'core/result';
import type { AppContext } from '../../app';
import { RequireRoles, Route } from '../decorators/route.decorator';
import { GhostRole } from '../middleware/role-guard';
import { postDTOToV1 } from './helpers/post';
import { NotFound } from './helpers/response';
import type { ReplyChainView } from './views/reply.chain.view';

export class ReplyChainController {
    constructor(private readonly replyChainView: ReplyChainView) {}

    @Route('GET', '/.ghost/activitypub/v1/replies/:post_ap_id')
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

        const replyChain = getValue(replyChainResult);

        const replyChainV1 = {
            ancestors: {
                chain: replyChain.ancestors.chain.map(postDTOToV1),
                hasMore: replyChain.ancestors.hasMore,
            },
            post: postDTOToV1(replyChain.post),
            children: replyChain.children.map((child) => ({
                post: postDTOToV1(child.post),
                chain: child.chain.map(postDTOToV1),
                hasMore: child.hasMore,
            })),
            next: replyChain.next,
        };

        return new Response(JSON.stringify(replyChainV1), {
            status: 200,
        });
    }
}
