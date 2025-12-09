import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Knex } from 'knex';

import { DEFAULT_TOPIC_SLUG, TopicView } from '@/http/api/views/topic.view';
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

        it('should order topics by account count descending, then by name ascending', async () => {
            const [account1] = await fixtureManager.createInternalAccount();
            const [account2] = await fixtureManager.createInternalAccount();
            const [account3] = await fixtureManager.createInternalAccount();

            // Topic with 1 account
            const topicA = await fixtureManager.createTopic('Apples', 'apples');
            await fixtureManager.addAccountToTopic(account1.id, topicA.id);

            // Topic with 3 accounts (most popular)
            const topicZ = await fixtureManager.createTopic('Zebras', 'zebras');
            await fixtureManager.addAccountToTopic(account1.id, topicZ.id);
            await fixtureManager.addAccountToTopic(account2.id, topicZ.id);
            await fixtureManager.addAccountToTopic(account3.id, topicZ.id);

            // Topic with 2 accounts
            const topicM = await fixtureManager.createTopic('Music', 'music');
            await fixtureManager.addAccountToTopic(account1.id, topicM.id);
            await fixtureManager.addAccountToTopic(account2.id, topicM.id);

            const topics = await topicView.getTopics();

            expect(topics).toHaveLength(3);
            // First: Zebras (3 accounts)
            expect(topics[0].name).toBe('Zebras');
            // Second: Music (2 accounts)
            expect(topics[1].name).toBe('Music');
            // Third: Apples (1 account)
            expect(topics[2].name).toBe('Apples');
        });

        it('should order topics with same account count by name ascending', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            // All topics have 1 account each
            const topicZ = await fixtureManager.createTopic('Zebras', 'zebras');
            const topicA = await fixtureManager.createTopic('Apples', 'apples');
            const topicM = await fixtureManager.createTopic('Music', 'music');

            await fixtureManager.addAccountToTopic(account.id, topicZ.id);
            await fixtureManager.addAccountToTopic(account.id, topicA.id);
            await fixtureManager.addAccountToTopic(account.id, topicM.id);

            const topics = await topicView.getTopics();

            expect(topics).toHaveLength(3);
            // When account counts are equal, order by name ascending
            expect(topics[0].name).toBe('Apples');
            expect(topics[1].name).toBe('Music');
            expect(topics[2].name).toBe('Zebras');
        });

        it(`should render "${DEFAULT_TOPIC_SLUG}" topic first regardless of account count`, async () => {
            const [account1] = await fixtureManager.createInternalAccount();
            const [account2] = await fixtureManager.createInternalAccount();
            const [account3] = await fixtureManager.createInternalAccount();

            // Create default topic with only 1 account
            const topTopic = await fixtureManager.createTopic(
                'Default',
                DEFAULT_TOPIC_SLUG,
            );
            await fixtureManager.addAccountToTopic(account1.id, topTopic.id);

            // Create other topics with more accounts
            const popularTopic = await fixtureManager.createTopic(
                'Popular',
                'popular',
            );
            await fixtureManager.addAccountToTopic(
                account1.id,
                popularTopic.id,
            );
            await fixtureManager.addAccountToTopic(
                account2.id,
                popularTopic.id,
            );
            await fixtureManager.addAccountToTopic(
                account3.id,
                popularTopic.id,
            );

            const techTopic = await fixtureManager.createTopic(
                'Technology',
                'technology',
            );
            await fixtureManager.addAccountToTopic(account1.id, techTopic.id);
            await fixtureManager.addAccountToTopic(account2.id, techTopic.id);

            const topics = await topicView.getTopics();

            expect(topics).toHaveLength(3);
            // "top" should be first, even though it has fewer accounts
            expect(topics[0].slug).toBe(DEFAULT_TOPIC_SLUG);

            // Then ordered by account count
            expect(topics[1].slug).toBe('popular');
            expect(topics[2].slug).toBe('technology');
        });
    });
});
