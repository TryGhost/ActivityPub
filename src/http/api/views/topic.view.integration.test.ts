import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Knex } from 'knex';

import { TopicView } from '@/http/api/views/topic.view';
import { createTestDb } from '@/test/db';
import { createFixtureManager, type FixtureManager } from '@/test/fixtures';

describe('TopicView', () => {
    let db: Knex;
    let fixtureManager: FixtureManager;
    let topicView: TopicView;

    beforeAll(async () => {
        db = await createTestDb();
        fixtureManager = await createFixtureManager(db);
    });

    beforeEach(async () => {
        await fixtureManager.reset();
        topicView = new TopicView(db);
    });

    afterAll(async () => {
        await db.destroy();
    });

    describe('getTopics', () => {
        it('should return empty array when no topics exist', async () => {
            const topics = await topicView.getTopics();

            expect(topics).toHaveLength(0);
        });

        it('should return empty array when topics exist but have no accounts', async () => {
            await fixtureManager.createTopic('Technology', 'technology');
            await fixtureManager.createTopic('Science', 'science');

            const topics = await topicView.getTopics();

            expect(topics).toHaveLength(0);
        });

        it('should return topics that have at least one account', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            const topicWithAccount = await fixtureManager.createTopic(
                'Technology',
                'technology',
            );
            await fixtureManager.createTopic('Science', 'science'); // No accounts

            await fixtureManager.addAccountToTopic(
                account.id,
                topicWithAccount.id,
            );

            const topics = await topicView.getTopics();

            expect(topics).toHaveLength(1);
            expect(topics[0].slug).toBe('technology');
            expect(topics[0].name).toBe('Technology');
        });

        it('should return expected fields for topics', async () => {
            const [account] = await fixtureManager.createInternalAccount();
            const topic = await fixtureManager.createTopic(
                'Technology',
                'technology',
            );
            await fixtureManager.addAccountToTopic(account.id, topic.id);

            const topics = await topicView.getTopics();

            expect(topics).toHaveLength(1);
            expect(topics[0]).toEqual({
                slug: 'technology',
                name: 'Technology',
            });
        });

        it('should order topics by display_order first, then by name', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            const topicA = await fixtureManager.createTopic(
                'Apples',
                'apples',
                1,
            );
            const topicZ = await fixtureManager.createTopic(
                'Zebras',
                'zebras',
                3,
            );
            const topicM = await fixtureManager.createTopic(
                'Music',
                'music',
                2,
            );

            await fixtureManager.addAccountToTopic(account.id, topicA.id);
            await fixtureManager.addAccountToTopic(account.id, topicZ.id);
            await fixtureManager.addAccountToTopic(account.id, topicM.id);

            const topics = await topicView.getTopics();

            expect(topics).toHaveLength(3);
            expect(topics[0].name).toBe('Apples'); // display_order=1
            expect(topics[1].name).toBe('Music'); // display_order=2
            expect(topics[2].name).toBe('Zebras'); // display_order=3
        });

        it('should order topics by name when display_order is the same', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            // All topics have display_order=0 (default)
            const topicZ = await fixtureManager.createTopic('Zebras', 'zebras');
            const topicA = await fixtureManager.createTopic('Apples', 'apples');
            const topicM = await fixtureManager.createTopic('Music', 'music');

            await fixtureManager.addAccountToTopic(account.id, topicZ.id);
            await fixtureManager.addAccountToTopic(account.id, topicA.id);
            await fixtureManager.addAccountToTopic(account.id, topicM.id);

            const topics = await topicView.getTopics();

            expect(topics).toHaveLength(3);
            expect(topics[0].name).toBe('Apples');
            expect(topics[1].name).toBe('Music');
            expect(topics[2].name).toBe('Zebras');
        });
    });
});
