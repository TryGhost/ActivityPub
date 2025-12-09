import type { Knex } from 'knex';

import type { TopicDTO } from '@/http/api/types';

export class TopicView {
    constructor(private readonly db: Knex) {}

    async getTopics(): Promise<TopicDTO[]> {
        return await this.db('topics')
            .select('slug', 'name')
            .whereExists(
                this.db('account_topics').whereRaw(
                    'account_topics.topic_id = topics.id',
                ),
            )
            .orderBy('display_order', 'asc')
            .orderBy('name', 'asc');
    }
}
