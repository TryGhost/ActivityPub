import type { Knex } from 'knex';

import { getAccountHandle } from '@/account/utils';
import type { AccountSearchResult } from '@/http/api/search.controller';

const SEARCH_RESULT_LIMIT = 20;

export class AccountSearchView {
    constructor(private readonly db: Knex) {}

    async search(
        query: string,
        viewerAccountId: number,
    ): Promise<AccountSearchResult[]> {
        const trimmedQuery = query.trim();

        if (trimmedQuery.length === 0) {
            return [];
        }

        // Sanitize query for LIKE patterns (escape %, _, \)
        const sanitizedQuery = trimmedQuery.replace(/[%_\\]/g, '\\$&');

        // Prepare query for FULLTEXT boolean mode:
        const fulltextQuery = trimmedQuery
            // Strip TLD suffix (e.g., .com, .it) as they are often MySQL stopwords
            .replace(/\.[a-z]{2,}$/i, '')
            // Replace special characters that have meaning in boolean mode or act as word separators with spaces
            .replace(/[+\-><()~*"@.\\/]/g, ' ')
            // Split into words and filter empty terms
            .split(/\s+/)
            .filter((term) => term.length > 0)
            // Prefix each with + (required) and suffix with * (prefix match)
            .map((term) => `+${term}*`)
            .join(' ');

        // If no valid search terms remain after sanitization, return empty
        if (fulltextQuery.length === 0) {
            return [];
        }

        // Rank order:
        // 0. name starts with
        // 1. name contains
        // 2. handle starts with
        // 3. handle contains
        // 4. domain starts with
        // 5. domain contains
        const rankExpression = this.db.raw(
            `CASE
                WHEN accounts.name LIKE ? ESCAPE '\\\\' THEN 0
                WHEN accounts.name LIKE ? ESCAPE '\\\\' THEN 1
                WHEN CONCAT('@', accounts.username, '@', accounts.domain) LIKE ? ESCAPE '\\\\' THEN 2
                WHEN CONCAT('@', accounts.username, '@', accounts.domain) LIKE ? ESCAPE '\\\\' THEN 3
                WHEN accounts.domain LIKE ? ESCAPE '\\\\' THEN 4
                WHEN accounts.domain LIKE ? ESCAPE '\\\\' THEN 5
                ELSE 6
            END as search_rank`,
            [
                `${sanitizedQuery}%`,
                `%${sanitizedQuery}%`,
                `${sanitizedQuery}%`,
                `%${sanitizedQuery}%`,
                `${sanitizedQuery}%`,
                `%${sanitizedQuery}%`,
            ],
        );

        return this.searchByQuery(
            viewerAccountId,
            (qb) =>
                qb.whereRaw(
                    'MATCH(accounts.name, accounts.username, accounts.domain) AGAINST(? IN BOOLEAN MODE)',
                    [fulltextQuery],
                ),
            SEARCH_RESULT_LIMIT,
            rankExpression,
        );
    }

    async searchByDomain(
        domain: string,
        viewerAccountId: number,
        limit: number = SEARCH_RESULT_LIMIT,
    ): Promise<AccountSearchResult[]> {
        return this.searchByQuery(
            viewerAccountId,
            (qb) =>
                qb.whereRaw(
                    'accounts.domain_hash = UNHEX(SHA2(LOWER(?), 256))',
                    [domain],
                ),
            limit,
        );
    }

    private async searchByQuery(
        viewerAccountId: number,
        whereClause: Knex.QueryCallback,
        limit: number,
        rankExpression?: Knex.Raw,
    ): Promise<AccountSearchResult[]> {
        const query = this.db('accounts')
            .select(
                'accounts.ap_id',
                'accounts.name',
                'accounts.username',
                'accounts.domain',
                'accounts.avatar_url',
            )
            .where(whereClause)
            // Compute followedByMe
            .select(
                this.db.raw(`
                CASE
                    WHEN follows.following_id IS NOT NULL THEN 1
                    ELSE 0
                END AS followed_by_me
            `),
            )
            // Compute is_ghost_site (has associated user record)
            .select(
                this.db.raw(`
                CASE
                    WHEN users.account_id IS NOT NULL THEN 1
                    ELSE 0
                END AS is_ghost_site
            `),
            )
            .leftJoin('follows', function () {
                this.on('follows.following_id', 'accounts.id').andOnVal(
                    'follows.follower_id',
                    '=',
                    viewerAccountId.toString(),
                );
            })
            // Join users table to detect Ghost sites (internal accounts)
            .leftJoin('users', 'users.account_id', 'accounts.id')
            // Filter out blocked accounts
            .leftJoin('blocks', function () {
                this.on('blocks.blocked_id', 'accounts.id').andOnVal(
                    'blocks.blocker_id',
                    '=',
                    viewerAccountId.toString(),
                );
            })
            .leftJoin('domain_blocks', function () {
                this.on(
                    'domain_blocks.domain_hash',
                    'accounts.domain_hash',
                ).andOnVal(
                    'domain_blocks.blocker_id',
                    '=',
                    viewerAccountId.toString(),
                );
            })
            .whereNull('blocks.id')
            .whereNull('domain_blocks.id');

        // Add search_rank column and order by it if provided
        if (rankExpression) {
            query.select(rankExpression);

            query.orderBy('search_rank', 'asc');
        }

        // Default ordering and limit
        const results = await query
            .orderBy('is_ghost_site', 'desc')
            .orderBy('accounts.name', 'asc')
            .limit(limit);

        return results.map((result) => ({
            id: result.ap_id,
            name: result.name || '',
            handle: getAccountHandle(result.domain, result.username),
            avatarUrl: result.avatar_url || null,
            followedByMe: result.followed_by_me === 1,
            // blockedByMe and domainBlockedByMe are always false since we filter them out
            blockedByMe: false,
            domainBlockedByMe: false,
        }));
    }
}
