import type { Knex } from 'knex';

import { getAccountHandle } from '@/account/utils';
import type { AccountSearchResult } from '@/http/api/search.controller';

const SEARCH_RESULT_LIMIT = 20;

// Normal query weights - prioritizes name matches (e.g., "ghost", "john smith")
const NORMAL_WEIGHTS = {
    NAME_STARTS_WITH: 100,
    NAME_CONTAINS: 80,
    USERNAME_STARTS_WITH: 60,
    USERNAME_CONTAINS: 50,
    DOMAIN_STARTS_WITH: 40,
    DOMAIN_CONTAINS: 30,
    BIO_CONTAINS: 20,
};

// Handle query weights - prioritizes username/domain matches (e.g., "@ghost@", "@john@john")
const HANDLE_WEIGHTS = {
    USERNAME_STARTS_WITH: 100,
    USERNAME_CONTAINS: 80,
    DOMAIN_STARTS_WITH: 60,
    DOMAIN_CONTAINS: 50,
    NAME_STARTS_WITH: 40,
    NAME_CONTAINS: 30,
    BIO_CONTAINS: 20,
};

export class AccountSearchView {
    constructor(private readonly db: Knex) {}

    async search(
        query: string,
        viewerAccountId: number,
    ): Promise<AccountSearchResult[]> {
        // Detect if query looks like a handle (starts with @)
        const isHandleQuery = query.trimStart().startsWith('@');

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
            .map((term) =>
                term.replace(/[+\-<>~*"()]/g, '').replace(/[%_\\]/g, '\\$&'),
            )
            .filter((term) => term.length > 0);

        if (sanitizedTerms.length === 0) {
            return [];
        }

        // Separate terms into long (4+ chars, use FULLTEXT) and short (< 4 chars, use LIKE)
        const longTerms = sanitizedTerms.filter((term) => term.length >= 4);
        const shortTerms = sanitizedTerms.filter((term) => term.length < 4);

        // Build FULLTEXT query for long terms: "+term1 +term2"
        const usernameDomainfullTextQuery = longTerms
            .map((term) => `+${term}`)
            .join(' ');

        return this.searchByQuery(
            viewerAccountId,
            (qb) => {
                qb.where(function () {
                    // Option 1: username / domain search - best for @user@domain queries
                    // Only use this path if we have at least one long term (for FULLTEXT anchor)
                    if (longTerms.length > 0) {
                        this.where(function () {
                            // FULLTEXT for long terms (fast n-gram index lookup)
                            this.whereRaw(
                                'MATCH(accounts.username, accounts.domain) AGAINST(? IN BOOLEAN MODE)',
                                [usernameDomainfullTextQuery],
                            );
                            // LIKE for short terms (runs on FULLTEXT-filtered set, so fast)
                            for (const term of shortTerms) {
                                const lowerTerm = term.toLowerCase();

                                this.whereRaw(
                                    '(LOWER(accounts.username) LIKE ? OR LOWER(accounts.domain) LIKE ?)',
                                    [`%${lowerTerm}%`, `%${lowerTerm}%`],
                                );
                            }
                        });
                    }

                    // Option 2: name / bio search - for word based queries
                    this.orWhere(function () {
                        for (const term of sanitizedTerms) {
                            this.whereRaw(
                                'MATCH(accounts.name, accounts.bio) AGAINST(? IN BOOLEAN MODE)',
                                [`${term}*`],
                            );
                        }
                    });
                });
            },
            SEARCH_RESULT_LIMIT,
            this.buildRelevanceScoreExpression(sanitizedTerms, isHandleQuery),
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

    private buildRelevanceScoreExpression(
        terms: string[],
        isHandleQuery: boolean,
    ): Knex.Raw {
        const weights = isHandleQuery ? HANDLE_WEIGHTS : NORMAL_WEIGHTS;

        // Build score for a single term
        // CASE returns first match, so order must match weight priority
        const buildTermScore = (term: string): { sql: string; params: unknown[] } => {
            const lowerTerm = term.toLowerCase();

            if (isHandleQuery) {
                // Handle query: username → domain → name → bio
                const sql = `
                    CASE
                        WHEN LOWER(accounts.username) LIKE ? ESCAPE '\\\\' THEN ?
                        WHEN LOWER(accounts.username) LIKE ? ESCAPE '\\\\' THEN ?
                        WHEN LOWER(accounts.domain) LIKE ? ESCAPE '\\\\' THEN ?
                        WHEN LOWER(accounts.domain) LIKE ? ESCAPE '\\\\' THEN ?
                        WHEN LOWER(accounts.name) LIKE ? ESCAPE '\\\\' THEN ?
                        WHEN LOWER(accounts.name) LIKE ? ESCAPE '\\\\' THEN ?
                        WHEN LOWER(accounts.bio) LIKE ? ESCAPE '\\\\' THEN ?
                        ELSE 0
                    END`;
                const params = [
                    `${lowerTerm}%`,
                    weights.USERNAME_STARTS_WITH,
                    `%${lowerTerm}%`,
                    weights.USERNAME_CONTAINS,
                    `${lowerTerm}%`,
                    weights.DOMAIN_STARTS_WITH,
                    `%${lowerTerm}%`,
                    weights.DOMAIN_CONTAINS,
                    `${lowerTerm}%`,
                    weights.NAME_STARTS_WITH,
                    `%${lowerTerm}%`,
                    weights.NAME_CONTAINS,
                    `%${lowerTerm}%`,
                    weights.BIO_CONTAINS,
                ];
                return { sql, params };
            }

            // Normal query: name → username → domain → bio
            const sql = `
                CASE
                    WHEN LOWER(accounts.name) LIKE ? ESCAPE '\\\\' THEN ?
                    WHEN LOWER(accounts.name) LIKE ? ESCAPE '\\\\' THEN ?
                    WHEN LOWER(accounts.username) LIKE ? ESCAPE '\\\\' THEN ?
                    WHEN LOWER(accounts.username) LIKE ? ESCAPE '\\\\' THEN ?
                    WHEN LOWER(accounts.domain) LIKE ? ESCAPE '\\\\' THEN ?
                    WHEN LOWER(accounts.domain) LIKE ? ESCAPE '\\\\' THEN ?
                    WHEN LOWER(accounts.bio) LIKE ? ESCAPE '\\\\' THEN ?
                    ELSE 0
                END`;
            const params = [
                `${lowerTerm}%`,
                weights.NAME_STARTS_WITH,
                `%${lowerTerm}%`,
                weights.NAME_CONTAINS,
                `${lowerTerm}%`,
                weights.USERNAME_STARTS_WITH,
                `%${lowerTerm}%`,
                weights.USERNAME_CONTAINS,
                `${lowerTerm}%`,
                weights.DOMAIN_STARTS_WITH,
                `%${lowerTerm}%`,
                weights.DOMAIN_CONTAINS,
                `%${lowerTerm}%`,
                weights.BIO_CONTAINS,
            ];
            return { sql, params };
        };

        // Score first term
        const firstTermScore = buildTermScore(terms[0]);

        if (terms.length === 1) {
            return this.db.raw(
                `(${firstTermScore.sql}) AS relevance_score`,
                firstTermScore.params,
            );
        }

        // For two terms, sum the scores (second term typically matches domain)
        const secondTermScore = buildTermScore(terms[1]);

        return this.db.raw(
            `((${firstTermScore.sql}) + (${secondTermScore.sql})) AS relevance_score`,
            [...firstTermScore.params, ...secondTermScore.params],
        );
    }
}
