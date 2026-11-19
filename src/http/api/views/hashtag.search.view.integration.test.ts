import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Knex } from 'knex';

import { HashtagSearchView } from '@/http/api/views/hashtag.search.view';
import { createTestDb } from '@/test/db';
import { createFixtureManager, type FixtureManager } from '@/test/fixtures';

describe('HashtagSearchView', () => {
    let db: Knex;
    let fixtureManager: FixtureManager;
    let hashtagSearchView: HashtagSearchView;

    beforeAll(async () => {
        db = await createTestDb();
        fixtureManager = createFixtureManager(db);
    });

    beforeEach(async () => {
        await fixtureManager.reset();

        await db('hashtags').insert(
            ['news', 'newsletter', 'ghost', 'new_york', 'newyork'].map(
                (name) => ({ name }),
            ),
        );

        hashtagSearchView = new HashtagSearchView(db);
    });

    it('should return hashtags starting with the query, exact match first', async () => {
        const results = await hashtagSearchView.search('news');

        expect(results).toEqual([{ name: 'news' }, { name: 'newsletter' }]);
    });

    it('should normalize the query', async () => {
        const results = await hashtagSearchView.search('  #NEWS ');

        expect(results).toEqual([{ name: 'news' }, { name: 'newsletter' }]);
    });

    it('should treat underscores in the query literally', async () => {
        const results = await hashtagSearchView.search('new_');

        expect(results).toEqual([{ name: 'new_york' }]);
    });

    it('should return no hashtags for a query that is not a valid hashtag', async () => {
        expect(await hashtagSearchView.search('#')).toEqual([]);
        expect(await hashtagSearchView.search('news letter')).toEqual([]);
        expect(await hashtagSearchView.search('%')).toEqual([]);
    });

    it('should limit the number of results', async () => {
        await db('hashtags').insert(
            Array.from({ length: 15 }, (_, index) => ({
                name: `tag${String(index).padStart(2, '0')}`,
            })),
        );

        const results = await hashtagSearchView.search('tag');

        expect(results).toHaveLength(10);
        expect(results[0]).toEqual({ name: 'tag00' });
    });
});
