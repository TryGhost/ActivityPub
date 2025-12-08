import type { Knex } from 'knex';

import { getAccountHandle } from '@/account/utils';
import { sanitizeHtml } from '@/helpers/html';
import type { ExploreAccountDTO } from '@/http/api/types';

const DEFAULT_TOPIC_SLUG = 'top';

export class RecommendationsView {
    constructor(private readonly db: Knex) {}

    async getRecommendations(
        viewerAccountId: number,
        limit: number,
    ): Promise<ExploreAccountDTO[]> {
        const viewerTopics = await this.db('account_topics')
            .select('topic_id')
            .where('account_id', viewerAccountId);

        const viewerTopicIds = viewerTopics.map((t) => t.topic_id);

        let recommendations: ExploreAccountDTO[] = [];

        // Try to get recommendations from viewer's topic(s) first
        if (viewerTopicIds.length > 0) {
            recommendations = await this.getRecommendationsFromTopics(
                viewerAccountId,
                viewerTopicIds,
                [],
                limit,
            );
        }

        // If we need more recommendations, fallback to default topic
        if (recommendations.length < limit) {
            const remaining = limit - recommendations.length;
            const existingIds = recommendations.map((a) => a.id);

            const defaultTopic = await this.db('topics')
                .select('id')
                .where('slug', DEFAULT_TOPIC_SLUG)
                .first();

            if (defaultTopic) {
                const defaultTopicRecommendations =
                    await this.getRecommendationsFromTopics(
                        viewerAccountId,
                        [defaultTopic.id],
                        existingIds,
                        remaining,
                    );

                recommendations = [
                    ...recommendations,
                    ...defaultTopicRecommendations,
                ];
            }
        }

        return recommendations;
    }

    private async getRecommendationsFromTopics(
        viewerAccountId: number,
        topicIds: number[],
        excludeApIds: string[],
        limit: number,
    ) {
        const query = this.db('accounts')
            .select(
                'accounts.ap_id',
                'accounts.name',
                'accounts.username',
                'accounts.domain',
                'accounts.avatar_url',
                'accounts.bio',
                'accounts.url',
            )
            .distinct('accounts.ap_id')

            // Filter accounts by topics
            .innerJoin(
                'account_topics',
                'account_topics.account_id',
                'accounts.id',
            )
            .whereIn('account_topics.topic_id', topicIds)

            // Exclude the viewer
            .whereNot('accounts.id', viewerAccountId)

            // Exclude accounts the viewer already follows
            .leftJoin('follows', function () {
                this.on('follows.following_id', 'accounts.id').andOnVal(
                    'follows.follower_id',
                    '=',
                    viewerAccountId.toString(),
                );
            })
            .whereNull('follows.id')

            // Exclude blocked accounts
            .leftJoin('blocks', function () {
                this.on('blocks.blocked_id', 'accounts.id').andOnVal(
                    'blocks.blocker_id',
                    '=',
                    viewerAccountId.toString(),
                );
            })
            .whereNull('blocks.id')

            // Exclude domain-blocked accounts
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
            .whereNull('domain_blocks.id')

            .orderByRaw('RAND()')
            .limit(limit);

        if (excludeApIds.length > 0) {
            query.whereNotIn('accounts.ap_id', excludeApIds);
        }

        const results = await query;

        return this.mapResultsToDTO(results);
    }

    private mapResultsToDTO(
        results: Array<{
            ap_id: string;
            name: string | null;
            username: string;
            domain: string;
            avatar_url: string | null;
            bio: string | null;
            url: string | null;
        }>,
    ): ExploreAccountDTO[] {
        return results.map((result) => ({
            id: result.ap_id,
            name: result.name || '',
            handle: getAccountHandle(result.domain, result.username),
            avatarUrl: result.avatar_url || null,
            bio: sanitizeHtml(result.bio || ''),
            url: result.url || null,
            followedByMe: false, // Recommendations are accounts the viewer doesn't follow
        }));
    }
}
