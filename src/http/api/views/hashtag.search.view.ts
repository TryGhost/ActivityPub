import type { Knex } from 'knex';

import { normalizeHashtagPrefix } from '@/post/hashtag';

const SEARCH_RESULT_LIMIT = 10;

export interface HashtagSearchResult {
    /**
     * Normalized name of the hashtag, without the leading `#`
     */
    name: string;
}

export class HashtagSearchView {
    constructor(private readonly db: Knex) {}

    /**
     * Search for hashtags starting with the query. An exact match is returned
     * first, as it sorts before any longer name with the same prefix.
     *
     * @param query Search query, with or without a leading `#`
     */
    async search(query: string): Promise<HashtagSearchResult[]> {
        const hashtag = normalizeHashtagPrefix(query.trim());

        if (hashtag === null) {
            return [];
        }

        // Escape LIKE wildcards - `_` is valid in hashtag names. The escape
        // character is set explicitly, as the default one depends on the
        // server's SQL mode
        const prefix = hashtag.replace(/[!%_]/g, '!$&');

        return this.db('hashtags')
            .select('name')
            .whereRaw("name LIKE ? ESCAPE '!'", [`${prefix}%`])
            .orderBy('name', 'asc')
            .limit(SEARCH_RESULT_LIMIT);
    }
}
