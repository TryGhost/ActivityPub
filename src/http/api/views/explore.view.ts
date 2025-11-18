import type { Knex } from 'knex';

import { getAccountHandle } from '@/account/utils';
import type { ExploreAccountDTO } from '@/http/api/types';

const DEFAULT_EXPLORE_LIMIT = 20;

export class ExploreView {
    constructor(private readonly db: Knex) {}

    async getAccountsInTopic(
        slug: string,
        viewerAccountId: number,
        offset = 0,
        limit = DEFAULT_EXPLORE_LIMIT,
    ): Promise<{ accounts: ExploreAccountDTO[]; next: string | null }> {
        const results = await this.db('accounts')
            .select(
                'accounts.ap_id',
                'accounts.name',
                'accounts.username',
                'accounts.domain',
                'accounts.avatar_url',
                'accounts.bio',
                'accounts.url',
            )
            .innerJoin(
                'account_topics',
                'account_topics.account_id',
                'accounts.id',
            )
            .innerJoin('topics', 'topics.id', 'account_topics.topic_id')
            .where('topics.slug', slug)

            // Filter out the viewer account
            .whereNot('accounts.id', viewerAccountId)

            // Compute followedByMe
            .select(
                this.db.raw(`
                CASE
                    WHEN follows.following_id IS NOT NULL THEN 1
                    ELSE 0
                END AS followed_by_me
            `),
            )
            .leftJoin('follows', function () {
                this.on('follows.following_id', 'accounts.id').andOnVal(
                    'follows.follower_id',
                    '=',
                    viewerAccountId.toString(),
                );
            })

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

            // Pagination
            .orderBy('accounts.id', 'asc')
            .limit(limit + 1)
            .offset(offset);

        const hasMore = results.length > limit;
        const paginatedResults = results.slice(0, limit);
        const next = hasMore ? (offset + limit).toString() : null;

        const accounts = paginatedResults.map((result) => ({
            id: result.ap_id, // Note: we expose the ActivityPub ID as identifier to the client, instead of the internal ID
            name: result.name || '',
            handle: getAccountHandle(result.domain, result.username),
            avatarUrl: result.avatar_url || null,
            bio: result.bio || null,
            url: result.url || null,
            followedByMe: result.followed_by_me === 1,
        }));

        return {
            accounts,
            next,
        };
    }
}
