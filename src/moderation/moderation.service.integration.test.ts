import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Knex } from 'knex';

import { postToDTO } from 'http/api/helpers/post';
import { createTestDb } from 'test/db';
import { type FixtureManager, createFixtureManager } from 'test/fixtures';
import { ModerationService } from './moderation.service';

describe('ModerationService', () => {
    let client: Knex;
    let fixtureManager: FixtureManager;
    let moderationService: ModerationService;

    beforeAll(async () => {
        client = await createTestDb();
        fixtureManager = createFixtureManager(client);
        moderationService = new ModerationService(client);
    });

    beforeEach(async () => {
        await fixtureManager.reset();
    });

    it('should filter posts from blocked accounts', async () => {
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

    describe('filterUsersForPost', () => {
        it('should filter out users that have blocked the author', async () => {
            const [
                [aliceAccount, , aliceUserId],
                [bobAccount, , bobUserId],
                [charlieAccount, , charlieUserId],
            ] = await Promise.all([
                fixtureManager.createInternalAccount(),
                fixtureManager.createInternalAccount(),
                fixtureManager.createInternalAccount(),
            ]);

            const [, , , post] = await Promise.all([
                // alice follows bob and charlie
                fixtureManager.createFollow(aliceAccount, bobAccount),
                fixtureManager.createFollow(aliceAccount, charlieAccount),
                // alice blocks bob
                fixtureManager.createBlock(aliceAccount, bobAccount),
                // bob creates a post
                fixtureManager.createPost(bobAccount),
            ]);

            const users = await moderationService.filterUsersForPost(
                [aliceUserId, bobUserId, charlieUserId],
                post,
            );

            // alice should not see the post
            expect(users).toEqual([bobUserId, charlieUserId]);
        });

        it('should filter out users that have blocked the reposter', async () => {
            const [
                [aliceAccount, , aliceUserId],
                [bobAccount, , bobUserId],
                [charlieAccount, , charlieUserId],
            ] = await Promise.all([
                fixtureManager.createInternalAccount(),
                fixtureManager.createInternalAccount(),
                fixtureManager.createInternalAccount(),
            ]);

            const [, , , post] = await Promise.all([
                // alice follows bob and charlie
                fixtureManager.createFollow(aliceAccount, bobAccount),
                fixtureManager.createFollow(aliceAccount, charlieAccount),
                // alice blocks charlie
                fixtureManager.createBlock(aliceAccount, charlieAccount),
                // bob creates a post
                fixtureManager.createPost(bobAccount),
            ]);

            const users = await moderationService.filterUsersForPost(
                [aliceUserId, bobUserId, charlieUserId],
                post,
                charlieAccount.id!, // charlie reposted bob's post
            );

            // alice should not see the post
            expect(users).toEqual([bobUserId, charlieUserId]);
        });

        it('should filter out users that have blocked the author of a post that has been reposted by a followed account', async () => {
            const [
                [aliceAccount, , aliceUserId],
                [bobAccount, , bobUserId],
                [charlieAccount, , charlieUserId],
            ] = await Promise.all([
                fixtureManager.createInternalAccount(),
                fixtureManager.createInternalAccount(),
                fixtureManager.createInternalAccount(),
            ]);

            const [, , , post] = await Promise.all([
                // alice follows bob and charlie
                fixtureManager.createFollow(aliceAccount, bobAccount),
                fixtureManager.createFollow(aliceAccount, charlieAccount),
                // alice blocks bob
                fixtureManager.createBlock(aliceAccount, bobAccount),
                // bob creates a post
                fixtureManager.createPost(bobAccount),
            ]);

            const users = await moderationService.filterUsersForPost(
                [aliceUserId, bobUserId, charlieUserId],
                post,
                charlieAccount.id!, // charlie reposted bob's post
            );

            // alice should not see the post
            expect(users).toEqual([bobUserId, charlieUserId]);
        });

        it('should filter out users that are followers of an account that has reposted a post but has been blocked by the author', async () => {
            const [
                [aliceAccount, , aliceUserId],
                [bobAccount, , bobUserId],
                [charlieAccount, , charlieUserId],
            ] = await Promise.all([
                fixtureManager.createInternalAccount(),
                fixtureManager.createInternalAccount(),
                fixtureManager.createInternalAccount(),
            ]);

            const [, , , , post] = await Promise.all([
                // alice follows bob and charlie
                fixtureManager.createFollow(aliceAccount, bobAccount),
                fixtureManager.createFollow(aliceAccount, charlieAccount),
                // charlie follows bob
                fixtureManager.createFollow(charlieAccount, bobAccount),
                // alice blocks bob
                fixtureManager.createBlock(aliceAccount, bobAccount),
                // alice creates a post
                fixtureManager.createPost(aliceAccount),
            ]);

            const users = await moderationService.filterUsersForPost(
                [aliceUserId, bobUserId, charlieUserId],
                post,
                bobAccount.id!, // bob reposted alice's post
            );

            // - alice should not see the post because she blocked bob
            //   (the reposter)
            // - charlie should not see the post because the author (alice)
            //   blocked the reposter (bob), even though charlie follows bob
            expect(users).toEqual([bobUserId]);
        });
    });
});
