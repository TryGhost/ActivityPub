import type { Knex } from 'knex';

import { getAccountHandle } from '@/account/utils';
import type { AccountSearchResult } from '@/http/api/search.controller';

const SEARCH_RESULT_LIMIT = 20;

const RELEVANCE_WEIGHTS = {
    NAME_STARTS_WITH: 100,
    NAME_CONTAINS: 80,
    HANDLE_STARTS_WITH: 60,
    HANDLE_CONTAINS: 50,
    DOMAIN_STARTS_WITH: 40,
    DOMAIN_CONTAINS: 30,
    BIO_CONTAINS: 20,
};

export class AccountSearchView {
    constructor(private readonly db: Knex) {}

    async search(
        query: string,
        viewerAccountId: number,
    ): Promise<AccountSearchResult[]> {
        // Split on @ to extract search terms (e.g., "@foo@bar" → ["foo", "bar"])
        const terms = query
            .split('@')
            .map((t) => t.trim())
            .filter((t) => t.length > 0);

        if (terms.length === 0) {
            return [];
        }

        // Sanitize each term:
        // 1. Remove FULLTEXT boolean operators (+, -, <, >, ~, *, ", (, ))
        // 2. Escape SQL LIKE wildcards (%, _, \)
        const sanitizedTerms = terms
            .map(
                (t) =>
                    t
                        .replace(/[+\-<>~*"()]/g, '') // Strip FULLTEXT operators
                        .replace(/[%_\\]/g, '\\$&'), // Escape LIKE wildcards
            )
            .filter((t) => t.length > 0); // Remove empty terms after sanitization

        if (sanitizedTerms.length === 0) {
            return [];
        }

        return this.searchByQuery(
            viewerAccountId,
            (qb) => {
                // All terms must match (AND logic)
                // Each term can match in either index (OR logic within term)
                for (const term of sanitizedTerms) {
                    qb.where(function () {
                        // Standard FULLTEXT on name / bio (word-prefix matching)
                        this.whereRaw(
                            'MATCH(accounts.name, accounts.bio) AGAINST(? IN BOOLEAN MODE)',
                            [`${term}*`],
                        );
                        // N-gram FULLTEXT on username / domain (substring matching)
                        this.orWhereRaw(
                            'MATCH(accounts.username, accounts.domain) AGAINST(? IN BOOLEAN MODE)',
                            [term],
                        );
                    });
                }
            },
            SEARCH_RESULT_LIMIT,
            this.buildRelevanceScoreExpression(sanitizedTerms[0]), // Score based on first term
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
        relevanceScoreExpression?: Knex.Raw,
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
            // Compute followerCount
            .select(
                this.db.raw(
                    '(SELECT COUNT(*) FROM follows WHERE follows.following_id = accounts.id) as follower_count',
                ),
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

        // Add relevance score if provided
        if (relevanceScoreExpression) {
            query.select(relevanceScoreExpression);

            // Order by relevance score first, and then by other criteria
            query.orderBy('relevance_score', 'desc');
        }

        // Order by Ghost sites first, then alphabetically by name
        query.orderBy('is_ghost_site', 'desc');
        query.orderBy('accounts.name', 'asc');

        // Limit results
        query.limit(limit);

        const results = await query;

        return results.map((result) => ({
            id: result.ap_id,
            name: result.name || '',
            handle: getAccountHandle(result.domain, result.username),
            avatarUrl: result.avatar_url || null,
            followerCount: Number(result.follower_count),
            followedByMe: result.followed_by_me === 1,
            // blockedByMe and domainBlockedByMe are always false since we filter them out
            blockedByMe: false,
            domainBlockedByMe: false,
        }));
    }

    private buildRelevanceScoreExpression(term: string): Knex.Raw {
        const normalizedTerm = term.toLowerCase();

        return this.db.raw(
            `
            CASE
                WHEN LOWER(accounts.name) LIKE ? ESCAPE '\\\\' THEN ?
                WHEN LOWER(accounts.name) LIKE ? ESCAPE '\\\\' THEN ?
                WHEN LOWER(accounts.username) LIKE ? ESCAPE '\\\\' THEN ?
                WHEN LOWER(accounts.username) LIKE ? ESCAPE '\\\\' THEN ?
                WHEN LOWER(accounts.domain) LIKE ? ESCAPE '\\\\' THEN ?
                WHEN LOWER(accounts.domain) LIKE ? ESCAPE '\\\\' THEN ?
                WHEN LOWER(accounts.bio) LIKE ? ESCAPE '\\\\' THEN ?
                ELSE 0
            END AS relevance_score
            `,
            [
                `${normalizedTerm}%`,
                RELEVANCE_WEIGHTS.NAME_STARTS_WITH,
                `%${normalizedTerm}%`,
                RELEVANCE_WEIGHTS.NAME_CONTAINS,
                `${normalizedTerm}%`,
                RELEVANCE_WEIGHTS.HANDLE_STARTS_WITH,
                `%${normalizedTerm}%`,
                RELEVANCE_WEIGHTS.HANDLE_CONTAINS,
                `${normalizedTerm}%`,
                RELEVANCE_WEIGHTS.DOMAIN_STARTS_WITH,
                `%${normalizedTerm}%`,
                RELEVANCE_WEIGHTS.DOMAIN_CONTAINS,
                `%${normalizedTerm}%`,
                RELEVANCE_WEIGHTS.BIO_CONTAINS,
            ],
        );
    }
}
