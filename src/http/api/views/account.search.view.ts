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
        if (query.trim().length === 0) {
            return [];
        }

        // Sanitize query to escape SQL wildcards (%, _, \)
        const sanitizedQuery = query.trim().replace(/[%_\\]/g, '\\$&');

        // Rank order:
        // 0. name starts with
        // 1. name contains
        // 2. handle starts with
        // 3. handle contains
        // 4. domain starts with
        // 5. domain contains
        // 6. no match (will be filtered out via HAVING)
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
            SEARCH_RESULT_LIMIT,
            rankExpression,
        );
    }

    async searchByDomain(
        domain: string,
        viewerAccountId: number,
        limit: number = SEARCH_RESULT_LIMIT,
    ): Promise<AccountSearchResult[]> {
        return this.searchByQuery(viewerAccountId, limit, undefined, (qb) =>
            qb.whereRaw('accounts.domain_hash = UNHEX(SHA2(LOWER(?), 256))', [
                domain,
            ]),
        );
    }

    private async searchByQuery(
        viewerAccountId: number,
        limit: number,
        rankExpression?: Knex.Raw,
        whereClause?: Knex.QueryCallback,
    ): Promise<AccountSearchResult[]> {
        const query = this.db('accounts')
            .select(
                'accounts.ap_id',
                'accounts.name',
                'accounts.username',
                'accounts.domain',
                'accounts.avatar_url',
            )
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
                    viewerAccountId,
                );
            })
            .leftJoin('users', 'users.account_id', 'accounts.id')
            // Filter out blocked accounts using NOT EXISTS (more efficient than LEFT JOIN + WHERE NULL)
            .whereNotExists(function () {
                this.select(1)
                    .from('blocks')
                    .whereRaw('blocks.blocked_id = accounts.id')
                    .andWhere('blocks.blocker_id', viewerAccountId);
            })
            // Filter out domain-blocked accounts using NOT EXISTS (more efficient than LEFT JOIN + WHERE NULL)
            .whereNotExists(function () {
                this.select(1)
                    .from('domain_blocks')
                    .whereRaw(
                        'domain_blocks.domain_hash = accounts.domain_hash',
                    )
                    .andWhere('domain_blocks.blocker_id', viewerAccountId);
            });

        // Apply additional WHERE clause if provided (used by searchByDomain)
        if (whereClause) {
            query.where(whereClause);
        }

        // Add search_rank column and order by it if provided, and filter out non-matches (rank 6) using HAVING
        if (rankExpression) {
            query.select(rankExpression);
            query.having('search_rank', '<', 6);
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
