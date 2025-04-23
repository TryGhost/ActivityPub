import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Knex } from 'knex';
import { createTestDb } from 'test/db';
import { type FixtureManager, createFixtureManager } from 'test/fixtures';

import { postToDTO } from 'http/api/helpers/post';
import { ModerationService } from './moderation.service';

describe('ModerationService', () => {
    let client: Knex;
    let fixtureManager: FixtureManager;

    beforeAll(async () => {
        client = await createTestDb();
        fixtureManager = createFixtureManager(client);
    });

    beforeEach(async () => {
        await fixtureManager.reset();
    });

    it('should filter posts from blocked accounts', async () => {
        const moderationService = new ModerationService(client);

        const [[account], [blockedAccount]] = await Promise.all([
            fixtureManager.createInternalAccount(null, 'example.com'),
            fixtureManager.createInternalAccount(null, 'blocked.com'),
        ]);

        const [post1, post2, post3] = await Promise.all([
            fixtureManager.createPost(account),
            fixtureManager.createPost(blockedAccount),
            fixtureManager.createPost(account),
        ]);

        await fixtureManager.createBlock(account, blockedAccount);

        const posts = await moderationService.filterBlockedPostsForAccount(
            account,
            [postToDTO(post1), postToDTO(post2), postToDTO(post3)],
        );

        expect(posts).toHaveLength(2);
        expect(posts[0].id).toBe(post1.apId.toString());
        expect(posts[1].id).toBe(post3.apId.toString());
    });

    it('should filter posts from multiple blocked accounts', async () => {
        const moderationService = new ModerationService(client);

        const [[account], [blockedAccount1], [blockedAccount2]] =
            await Promise.all([
                fixtureManager.createInternalAccount(null, 'example.com'),
                fixtureManager.createInternalAccount(null, 'blocked1.com'),
                fixtureManager.createInternalAccount(null, 'blocked2.com'),
            ]);

        const [post1, post2, post3] = await Promise.all([
            fixtureManager.createPost(account),
            fixtureManager.createPost(blockedAccount1),
            fixtureManager.createPost(blockedAccount2),
        ]);

        await fixtureManager.createBlock(account, blockedAccount1);
        await fixtureManager.createBlock(account, blockedAccount2);

        const posts = await moderationService.filterBlockedPostsForAccount(
            account,
            [postToDTO(post1), postToDTO(post2), postToDTO(post3)],
        );

        expect(posts).toHaveLength(1);
        expect(posts[0].id).toBe(post1.apId.toString());
    });

    it('should filter reposts from blocked accounts', async () => {
        const moderationService = new ModerationService(client);

        const [[account], [unblockedAccount], [blockedAccount]] =
            await Promise.all([
                fixtureManager.createInternalAccount(null, 'example.com'),
                fixtureManager.createInternalAccount(null, 'unblocked.com'),
                fixtureManager.createInternalAccount(null, 'blocked.com'),
            ]);

        const [post1, post2, post3] = await Promise.all([
            fixtureManager.createPost(account),
            fixtureManager.createPost(unblockedAccount),
            fixtureManager.createPost(account),
        ]);

        await fixtureManager.createBlock(account, blockedAccount);

        const posts = await moderationService.filterBlockedPostsForAccount(
            account,
            [
                postToDTO(post1),
                postToDTO(post2, {
                    authoredByMe: false,
                    likedByMe: false,
                    repostedByMe: false,
                    repostedBy: blockedAccount,
                }),
                postToDTO(post3),
            ],
        );

        expect(posts).toHaveLength(2);
        expect(posts[0].id).toBe(post1.apId.toString());
        expect(posts[1].id).toBe(post3.apId.toString());
    });

    it('should do nothing if there are no posts', async () => {
        const moderationService = new ModerationService(client);

        const [account] = await fixtureManager.createInternalAccount(
            null,
            'example.com',
        );

        const posts = await moderationService.filterBlockedPostsForAccount(
            account,
            [],
        );

        expect(posts).toEqual([]);
    });
});
