import type { AppContext } from '@/app';
import type { ExploreView } from '@/http/api/views/explore.view';
import { APIRoute, RequireRoles } from '@/http/decorators/route.decorator';
import { GhostRole } from '@/http/middleware/role-guard';

export class ExploreController {
    constructor(private readonly exploreView: ExploreView) {}

    @APIRoute('GET', 'explore/:topic_slug')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
    async getAccountsPerTopic(ctx: AppContext) {
        const topicSlug = ctx.req.param('topic_slug');
        const viewerAccountId = ctx.get('account').id;

        const nextParam = ctx.req.query('next');
        const offset = nextParam ? Number.parseInt(nextParam, 10) : 0;

        if (Number.isNaN(offset) || offset < 0) {
            return new Response(
                JSON.stringify({
                    error: 'Invalid next parameter, expected a non-negative integer',
                }),
                {
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    status: 400,
                },
            );
        }

        const { accounts, next } = await this.exploreView.getAccountsInTopic(
            topicSlug,
            viewerAccountId,
            offset,
        );

        return new Response(
            JSON.stringify({
                accounts,
                next,
            }),
            {
                headers: {
                    'Content-Type': 'application/json',
                },
                status: 200,
            },
        );
    }
}
