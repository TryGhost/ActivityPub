import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Knex } from 'knex';

import { RecommendationsView } from '@/http/api/views/recommendations.view';
import { createTestDb } from '@/test/db';
import { createFixtureManager, type FixtureManager } from '@/test/fixtures';

describe('RecommendationsView', () => {
    let db: Knex;
    let fixtureManager: FixtureManager;
    let recommendationsView: RecommendationsView;

    beforeAll(async () => {
        db = await createTestDb();
        fixtureManager = await createFixtureManager(db);
    });

    beforeEach(async () => {
        await fixtureManager.reset();
        recommendationsView = new RecommendationsView(db);
    });

    afterAll(async () => {
        await db.destroy();
    });

    describe('getRecommendations', () => {
        it('should return empty array no topics exist', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();

            const accounts = await recommendationsView.getRecommendations(
                viewer.id,
                20,
            );

            expect(accounts).toHaveLength(0);
        });

        it('should return expected fields for accounts', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();
            const [account] = await fixtureManager.createInternalAccount();

            const topic = await fixtureManager.createTopic(
                'Technology',
                'technology',
            );

            await fixtureManager.addAccountToTopic(viewer.id, topic.id);
            await fixtureManager.addAccountToTopic(account.id, topic.id);

            const accounts = await recommendationsView.getRecommendations(
                viewer.id,
                20,
            );

            expect(accounts).toHaveLength(1);
            expect(accounts[0].id).toBe(account.apId.toString());
            expect(accounts[0].name).toBe(account.name);
            expect(accounts[0].handle).toBe(
                `@${account.username}@${account.apId.host}`,
            );
            expect(accounts[0].avatarUrl).toBe(
                account.avatarUrl ? account.avatarUrl.toString() : null,
            );
            expect(accounts[0].bio).toBe(account.bio);
            expect(accounts[0].url).toBe(
                account.url ? account.url.toString() : null,
            );
            expect(accounts[0].followedByMe).toBe(false);
        });

        it('should return accounts from viewers topic', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();
            const [accountOne] = await fixtureManager.createInternalAccount();
            const [accountTwo] = await fixtureManager.createInternalAccount();

            const topic = await fixtureManager.createTopic(
                'Technology',
                'technology',
            );

            // Add viewer and other accounts to same topic
            await fixtureManager.addAccountToTopic(viewer.id, topic.id);
            await fixtureManager.addAccountToTopic(accountOne.id, topic.id);
            await fixtureManager.addAccountToTopic(accountTwo.id, topic.id);

            const accounts = await recommendationsView.getRecommendations(
                viewer.id,
                20,
            );

            expect(accounts).toHaveLength(2);
            const ids = accounts.map((a) => a.id);
            expect(ids).toContain(accountOne.apId.toString());
            expect(ids).toContain(accountTwo.apId.toString());
        });

        it('should return accounts from multiple viewer topics', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();
            const [techAccount] = await fixtureManager.createInternalAccount();
            const [scienceAccount] =
                await fixtureManager.createInternalAccount();

            const techTopic = await fixtureManager.createTopic(
                'Technology',
                'technology',
            );
            const scienceTopic = await fixtureManager.createTopic(
                'Science',
                'science',
            );

            // Viewer is in both topics
            await fixtureManager.addAccountToTopic(viewer.id, techTopic.id);
            await fixtureManager.addAccountToTopic(viewer.id, scienceTopic.id);

            // Each topic has one account
            await fixtureManager.addAccountToTopic(
                techAccount.id,
                techTopic.id,
            );
            await fixtureManager.addAccountToTopic(
                scienceAccount.id,
                scienceTopic.id,
            );

            const accounts = await recommendationsView.getRecommendations(
                viewer.id,
                20,
            );

            expect(accounts).toHaveLength(2);

            const ids = accounts.map((a) => a.id);
            expect(ids).toContain(techAccount.apId.toString());
            expect(ids).toContain(scienceAccount.apId.toString());
        });

        it('should fallback to "top" topic when viewer has no topic', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();
            const [topAccount] = await fixtureManager.createInternalAccount();

            const topTopic = await fixtureManager.createTopic('Top', 'top');
            await fixtureManager.addAccountToTopic(topAccount.id, topTopic.id);

            // Viewer is NOT in any topic
            const accounts = await recommendationsView.getRecommendations(
                viewer.id,
                20,
            );

            expect(accounts).toHaveLength(1);
            expect(accounts[0].id).toBe(topAccount.apId.toString());
        });

        it('should use the default topic "top" to fill remaining slots when viewers topic has few accounts', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();
            const [viewerTopicAccount] =
                await fixtureManager.createInternalAccount();
            const [topAccount] = await fixtureManager.createInternalAccount();

            const viewerTopic = await fixtureManager.createTopic(
                'Technology',
                'technology',
            );
            const topTopic = await fixtureManager.createTopic('Top', 'top');

            await fixtureManager.addAccountToTopic(viewer.id, viewerTopic.id);
            await fixtureManager.addAccountToTopic(
                viewerTopicAccount.id,
                viewerTopic.id,
            );
            await fixtureManager.addAccountToTopic(topAccount.id, topTopic.id);

            const accounts = await recommendationsView.getRecommendations(
                viewer.id,
                20,
            );

            expect(accounts).toHaveLength(2);

            const ids = accounts.map((a) => a.id);
            expect(ids).toContain(viewerTopicAccount.apId.toString());
            expect(ids).toContain(topAccount.apId.toString());
        });

        it('should de-duplicate results', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();
            const [sharedAccount] =
                await fixtureManager.createInternalAccount();

            const techTopic = await fixtureManager.createTopic(
                'Technology',
                'technology',
            );
            const scienceTopic = await fixtureManager.createTopic(
                'Science',
                'science',
            );
            const topTopic = await fixtureManager.createTopic('Top', 'top');

            // Viewer is in Science, Technology
            await fixtureManager.addAccountToTopic(viewer.id, techTopic.id);
            await fixtureManager.addAccountToTopic(viewer.id, scienceTopic.id);

            // Account is in Science, Technology and Top
            await fixtureManager.addAccountToTopic(
                sharedAccount.id,
                scienceTopic.id,
            );
            await fixtureManager.addAccountToTopic(
                sharedAccount.id,
                techTopic.id,
            );
            await fixtureManager.addAccountToTopic(
                sharedAccount.id,
                topTopic.id,
            );

            const accounts = await recommendationsView.getRecommendations(
                viewer.id,
                20,
            );

            // Should only appear once
            expect(accounts).toHaveLength(1);
            expect(accounts[0].id).toBe(sharedAccount.apId.toString());
        });

        it('should exclude the viewer from recommendations', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();

            const topic = await fixtureManager.createTopic(
                'Technology',
                'technology',
            );

            await fixtureManager.addAccountToTopic(viewer.id, topic.id);

            const accounts = await recommendationsView.getRecommendations(
                viewer.id,
                20,
            );

            expect(accounts).toHaveLength(0);
        });

        it('should exclude accounts the viewer already follows', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();
            const [followedAccount] =
                await fixtureManager.createInternalAccount();
            const [notFollowedAccount] =
                await fixtureManager.createInternalAccount();

            const topic = await fixtureManager.createTopic(
                'Technology',
                'technology',
            );

            await fixtureManager.addAccountToTopic(viewer.id, topic.id);
            await fixtureManager.addAccountToTopic(
                followedAccount.id,
                topic.id,
            );
            await fixtureManager.addAccountToTopic(
                notFollowedAccount.id,
                topic.id,
            );

            // Viewer follows one account
            await fixtureManager.createFollow(viewer, followedAccount);

            const accounts = await recommendationsView.getRecommendations(
                viewer.id,
                20,
            );

            expect(accounts).toHaveLength(1);
            expect(accounts[0].id).toBe(notFollowedAccount.apId.toString());
        });

        it('should exclude blocked accounts', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();
            const [blockedAccount] =
                await fixtureManager.createInternalAccount();
            const [normalAccount] =
                await fixtureManager.createInternalAccount();

            const topic = await fixtureManager.createTopic(
                'Technology',
                'technology',
            );

            await fixtureManager.addAccountToTopic(viewer.id, topic.id);
            await fixtureManager.addAccountToTopic(blockedAccount.id, topic.id);
            await fixtureManager.addAccountToTopic(normalAccount.id, topic.id);

            // Viewer blocks one account
            await fixtureManager.createBlock(viewer, blockedAccount);

            const accounts = await recommendationsView.getRecommendations(
                viewer.id,
                20,
            );

            expect(accounts).toHaveLength(1);
            expect(accounts[0].id).toBe(normalAccount.apId.toString());
        });

        it('should exclude domain-blocked accounts', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();
            const [normalAccount] =
                await fixtureManager.createInternalAccount();
            const externalAccount = await fixtureManager.createExternalAccount(
                'https://blocked-domain.com/',
            );

            const topic = await fixtureManager.createTopic(
                'Technology',
                'technology',
            );

            await fixtureManager.addAccountToTopic(viewer.id, topic.id);
            await fixtureManager.addAccountToTopic(normalAccount.id, topic.id);
            await fixtureManager.addAccountToTopic(
                externalAccount.id,
                topic.id,
            );

            // Viewer blocks the domain
            await fixtureManager.createDomainBlock(
                viewer,
                new URL('https://blocked-domain.com'),
            );

            const accounts = await recommendationsView.getRecommendations(
                viewer.id,
                20,
            );

            expect(accounts).toHaveLength(1);
            expect(accounts[0].id).toBe(normalAccount.apId.toString());
        });

        it('should sanitize HTML in bio field', async () => {
            const [viewer] = await fixtureManager.createInternalAccount();

            const bioWithHtml =
                '<p>Hello <strong>world</strong>!</p><script>alert("xss")</script><img src=x onerror="alert(1)">';

            const [accountId] = await db('accounts').insert({
                ap_id: 'https://example.com/users/testuser',
                username: 'testuser',
                domain: 'example.com',
                ap_inbox_url: 'https://example.com/users/testuser/inbox',
                name: 'Test User',
                bio: bioWithHtml,
            });

            const topic = await fixtureManager.createTopic(
                'Technology',
                'technology',
            );

            await fixtureManager.addAccountToTopic(viewer.id, topic.id);
            await fixtureManager.addAccountToTopic(accountId, topic.id);

            const accounts = await recommendationsView.getRecommendations(
                viewer.id,
                20,
            );

            expect(accounts).toHaveLength(1);

            // Bio should have allowed HTML preserved
            expect(accounts[0].bio).toContain('<p>');
            expect(accounts[0].bio).toContain('<strong>');

            // Dangerous content inside script tags should be removed
            expect(accounts[0].bio).not.toContain('alert("xss")');

            // Event handlers should be removed
            expect(accounts[0].bio).not.toContain('onerror');
            expect(accounts[0].bio).not.toContain('alert(1)');
        });
    });
});
