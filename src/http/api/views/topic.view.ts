import type { Knex } from 'knex';

import type { TopicDTO } from '@/http/api/types';

export class TopicView {
    constructor(private readonly db: Knex) {}

    async getTopics(): Promise<TopicDTO[]> {
        const results = await this.db('topics')
            .select('topics.slug', 'topics.name')
            .count('account_topics.id as account_count')
            .innerJoin('account_topics', 'account_topics.topic_id', 'topics.id')
            .groupBy('topics.id')
            .orderBy('account_count', 'desc')
            .orderBy('topics.name', 'asc');

        return results.map((result) => ({
            slug: result.slug as string,
            name: result.name as string,
        }));
    }
}
