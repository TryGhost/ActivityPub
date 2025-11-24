import { pick } from 'es-toolkit';

import type { AppContext } from '@/app';
import { isHandle } from '@/helpers/activitypub/actor';
import { isUri } from '@/helpers/uri';
import type { AccountDTO } from '@/http/api/types';
import type { AccountSearchView } from '@/http/api/views/account.search.view';
import type { AccountView } from '@/http/api/views/account.view';
import { APIRoute, RequireRoles } from '@/http/decorators/route.decorator';
import { GhostRole } from '@/http/middleware/role-guard';

export type AccountSearchResult = Pick<
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
    constructor(
        private readonly accountView: AccountView,
        private readonly accountSearchView: AccountSearchView,
    ) {}

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

        // Init search results
        const results: SearchResults = {
            accounts: [],
        };

        const account = ctx.get('account');
        const requestUserContext = {
            requestUserAccount: account,
        };

        // Account handle search (exact match, single result)
        if (isHandle(query)) {
            const dto = await this.accountView.viewByHandle(
                query,
                requestUserContext,
            );

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

        if (isUri(query)) {
            const domain = new URL(query).hostname;

            // Search by domain name, if the account can be identified by its domain
            // Example: Ghost sites have individual domain, e.g. https://404media.co
            const domainMatch = await this.accountSearchView.searchByDomain(
                domain,
                account.id,
                2, // Search for more than one result
            );

            if (domainMatch.length === 1) {
                results.accounts = [domainMatch[0]];
                return new Response(JSON.stringify(results), {
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    status: 200,
                });
            }

            // Fallback to searching by AP ID
            // Example: https://mastodon.social/users/ghostexplore
            const apIdMatch = await this.accountView.viewByApId(
                query,
                requestUserContext,
            );

            if (apIdMatch !== null) {
                results.accounts.push(toSearchResult(apIdMatch));
            }

            return new Response(JSON.stringify(results), {
                headers: {
                    'Content-Type': 'application/json',
                },
                status: 200,
            });
        }

        // Account name search (partial match, multiple results)
        if (query.trim().length >= 2) {
            results.accounts = await this.accountSearchView.searchByName(
                query,
                account.id,
            );
        }

        return new Response(JSON.stringify(results), {
            headers: {
                'Content-Type': 'application/json',
            },
            status: 200,
        });
    }
}
