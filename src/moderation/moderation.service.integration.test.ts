import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Knex } from 'knex';
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

    describe('filterUsersForAccountInteraction', () => {
        it('should filter out users that have blocked the interaction account', async () => {
            const [
                [aliceAccount, , aliceUserId],
                [bobAccount, , bobUserId],
                [, , charlieUserId],
            ] = await Promise.all([
                fixtureManager.createInternalAccount(),
                fixtureManager.createInternalAccount(),
                fixtureManager.createInternalAccount(),
            ]);

            await Promise.all([
                // alice blocks bob
                fixtureManager.createBlock(aliceAccount, bobAccount),
            ]);

            const users =
                await moderationService.filterUsersForAccountInteraction(
                    [aliceUserId, bobUserId, charlieUserId],
                    bobAccount.id!,
                );

            // alice should be filtered out because she blocked bob
            expect(users).toEqual([bobUserId, charlieUserId]);
        });
    });
});
