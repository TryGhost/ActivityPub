import type { Knex } from 'knex';

import { getAccountHandle } from '@/account/utils';
import type { AccountSearchResult } from '@/http/api/search.controller';

const SEARCH_RESULT_LIMIT = 20;

export class AccountSearchView {
    constructor(private readonly db: Knex) {}

    async searchByName(
        query: string,
        viewerAccountId: number,
    ): Promise<AccountSearchResult[]> {
        // Return empty results for empty or whitespace-only queries
        if (query.trim().length === 0) {
            return [];
        }

        // Sanitize query to escape SQL wildcards (%, _, \)
        const sanitizedQuery = query.replace(/[%_\\]/g, '\\$&');

        const results = await this.db('accounts')
            .select(
                'accounts.ap_id',
                'accounts.name',
                'accounts.username',
                'accounts.domain',
                'accounts.avatar_url',
            )
            // Match on "name starts with"
            .whereRaw("accounts.name LIKE ? ESCAPE '\\\\'", [
                `${sanitizedQuery}%`,
            ])
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
            .whereNull('domain_blocks.id')
            // Order by Ghost sites first, then alphabetically by name
            .orderBy('is_ghost_site', 'desc')
            .orderBy('accounts.name', 'asc')
            // Limit results
            .limit(SEARCH_RESULT_LIMIT);

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

    async searchByDomain(
        domain: string,
        viewerAccountId: number,
        limit: number = SEARCH_RESULT_LIMIT,
    ): Promise<AccountSearchResult[]> {
        const results = await this.db('accounts')
            .select(
                'accounts.ap_id',
                'accounts.name',
                'accounts.username',
                'accounts.domain',
                'accounts.avatar_url',
            )
            .whereRaw('accounts.domain_hash = UNHEX(SHA2(LOWER(?), 256))', [
                domain,
            ])

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
            .whereNull('domain_blocks.id')
            // Order by Ghost sites first, then alphabetically by name
            .orderBy('is_ghost_site', 'desc')
            .orderBy('accounts.name', 'asc')
            // Limit results
            .limit(limit);

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
}
