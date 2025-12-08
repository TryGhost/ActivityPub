import type { AppContext } from '@/app';
import type { RecommendationsView } from '@/http/api/views/recommendations.view';
import { APIRoute, RequireRoles } from '@/http/decorators/route.decorator';
import { GhostRole } from '@/http/middleware/role-guard';

/**
 * Default number of recommendations to return
 */
const DEFAULT_RECOMMENDATIONS_LIMIT = 20;

/**
 * Maximum number of recommendations that can be returned
 */
const MAX_RECOMMENDATIONS_LIMIT = 100;

export class RecommendationsController {
    constructor(private readonly recommendationsView: RecommendationsView) {}

    @APIRoute('GET', 'recommendations')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
    async getRecommendations(ctx: AppContext) {
        const queryLimit = ctx.req.query('limit');
        const limit = queryLimit
            ? Number(queryLimit)
            : DEFAULT_RECOMMENDATIONS_LIMIT;

        if (
            Number.isNaN(limit) ||
            limit < 1 ||
            limit > MAX_RECOMMENDATIONS_LIMIT
        ) {
            return new Response(
                JSON.stringify({
                    error: `Invalid limit parameter, expected a positive number below ${MAX_RECOMMENDATIONS_LIMIT}`,
                    code: 'BAD_REQUEST',
                }),
                {
                    status: 400,
                },
            );
        }

        const viewerAccountId = ctx.get('account').id;

        const accounts = await this.recommendationsView.getRecommendations(
            viewerAccountId,
            limit,
        );

        return new Response(
            JSON.stringify({
                accounts,
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
