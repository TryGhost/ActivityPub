import { pick } from 'es-toolkit';
import type { AppContext } from '../../app';
import { isHandle } from '../../helpers/activitypub/actor';
import { isUri } from '../../helpers/uri';
import type { AccountDTO } from './types';
import type { AccountView } from './views/account.view';

type AccountSearchResult = Pick<
    AccountDTO,
    | 'id'
    | 'name'
    | 'handle'
    | 'avatarUrl'
    | 'followerCount'
    | 'followedByMe'
>;

function toSearchResult(dto: AccountDTO): AccountSearchResult {
    return pick(dto, [
        'id',
        'name',
        'handle',
        'avatarUrl',
        'followerCount',
        'followedByMe',
    ]);
}

interface SearchResults {
    accounts: AccountSearchResult[];
}

/**
 * Create a handler to handle a search request
 *
 * @param accountService Account service instance
 */
export function createSearchHandler(accountView: AccountView) {
    /**
     * Handle a search request
     *
     * @param ctx App context instance
     */
    return async function handleSearch(ctx: AppContext) {
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
            dto = await accountView.viewByHandle(query, requestUserContext);
        }

        if (isUri(query)) {
            dto = await accountView.viewByApId(query, requestUserContext);
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
    };
}
