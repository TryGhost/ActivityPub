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

        if (isUri(query)) {
            const domain = new URL(query).hostname;

            // Search by domain name first, for accounts that can be identified by a domain
            // Example: Ghost sites each have an individual domain (1 domain = 1 account)
            const domainMatch = await this.accountSearchView.searchByDomain(
                domain,
                account.id,
                2, // Search for more than one account
            );

            if (domainMatch.length === 1) {
                // Only use the domain match if the search query returned exactly one account
                results.accounts = [domainMatch[0]];

                return new Response(JSON.stringify(results), {
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    status: 200,
                });
            }

            // Fallback to searching by AP ID for accounts that cannot be identified by a domain (1 domain = multiple accounts)
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

        // Account search (partial match on name, handle, domain)
        if (query.trim().length >= 2) {
            results.accounts = await this.accountSearchView.search(
                query,
                account.id,
            );
        }

        // External account handle search (exact match, single result)
        if (isHandle(query) && results.accounts.length === 0) {
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

        return new Response(JSON.stringify(results), {
            headers: {
                'Content-Type': 'application/json',
            },
            status: 200,
        });
    }
}
