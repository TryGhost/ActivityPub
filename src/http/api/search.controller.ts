import { pick } from 'es-toolkit';

import type { AppContext } from '@/app';
import { isHandle } from '@/helpers/activitypub/actor';
import { isUri } from '@/helpers/uri';
import type { AccountDTO } from '@/http/api/types';
import type { AccountView } from '@/http/api/views/account.view';
import { APIRoute, RequireRoles } from '@/http/decorators/route.decorator';
import { GhostRole } from '@/http/middleware/role-guard';

type AccountSearchResult = Pick<
    AccountDTO,
    | 'id'
    | 'name'
    | 'handle'
    | 'avatarUrl'
    | 'followerCount'
    | 'followedByMe'
    | 'blockedByMe'
    | 'domainBlockedByMe'
>;

function toSearchResult(dto: AccountDTO): AccountSearchResult {
    return pick(dto, [
        'id',
        'name',
        'handle',
        'avatarUrl',
        'followerCount',
        'followedByMe',
        'blockedByMe',
        'domainBlockedByMe',
    ]);
}

interface SearchResults {
    accounts: AccountSearchResult[];
}

export class SearchController {
    constructor(private readonly accountView: AccountView) {}

    /**
     * Handle a search request
     *
     * @param ctx App context instance
     */
    @APIRoute('GET', 'actions/search')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
    async handleSearch(ctx: AppContext) {
        // Parse "query" from query parameters
        // ?query=<string>
        const queryQuery = ctx.req.query('query');
        const query = queryQuery ? decodeURIComponent(queryQuery) : '';

        // Init search results - At the moment we only support searching for an actor (account)
        const results: SearchResults = {
            accounts: [],
        };

        const requestUserContext = {
            requestUserAccount: ctx.get('account'),
        };

        let dto: AccountDTO | null = null;

        if (isHandle(query)) {
            dto = await this.accountView.viewByHandle(
                query,
                requestUserContext,
            );
        }

        if (isUri(query)) {
            dto = await this.accountView.viewByApId(query, requestUserContext);
        }

        if (dto !== null) {
            results.accounts.push(toSearchResult(dto));
        }

        return new Response(JSON.stringify(results), {
            headers: {
                'Content-Type': 'application/json',
            },
            status: 200,
        });
    }
}
