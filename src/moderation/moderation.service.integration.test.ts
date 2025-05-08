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

        it("should filter out users that have blocked the author's domain", async () => {
            const [
                [aliceAccount, , aliceUserId],
                [bobAccount, , bobUserId],
                [, , charlieUserId],
            ] = await Promise.all([
                fixtureManager.createInternalAccount(),
                fixtureManager.createInternalAccount(
                    null,
                    'blocked-domain.com',
                ),
                fixtureManager.createInternalAccount(),
            ]);

            // Create a post by bob (from the blocked domain)
            const post = await fixtureManager.createPost(bobAccount);

            // Alice blocks bob's domain
            await fixtureManager.createDomainBlock(
                aliceAccount,
                bobAccount.apId,
            );

            const users = await moderationService.filterUsersForPost(
                [aliceUserId, bobUserId, charlieUserId],
                post,
            );

            // alice should not see the post because she blocked bob's domain
            // bob should see the post (it's his own)
            // charlie should see the post (hasn't blocked the domain)
            expect(users).toEqual([bobUserId, charlieUserId]);
        });

        it("should filter out users that have blocked the reposter's domain", async () => {
            const [
                [aliceAccount, , aliceUserId],
                [bobAccount, , bobUserId],
                [charlieAccount, , charlieUserId],
            ] = await Promise.all([
                fixtureManager.createInternalAccount(),
                fixtureManager.createInternalAccount(),
                fixtureManager.createInternalAccount(
                    null,
                    'blocked-domain.com',
                ),
            ]);

            // Bob creates a post
            const post = await fixtureManager.createPost(bobAccount);

            // Alice blocks charlie's domain
            await fixtureManager.createDomainBlock(
                aliceAccount,
                charlieAccount.apId,
            );

            const users = await moderationService.filterUsersForPost(
                [aliceUserId, bobUserId, charlieUserId],
                post,
                charlieAccount.id!, // charlie reposted bob's post
            );

            // alice should not see the post because the reposter (charlie) is from a blocked domain
            // bob should see the post (it's his own)
            // charlie should see the post (hasn't blocked anyone)
            expect(users).toEqual([bobUserId, charlieUserId]);
        });

        it('should filter out users that are followers of an account that has reposted a post but has been domain blocked by the author', async () => {
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
                fixtureManager.createDomainBlock(aliceAccount, bobAccount.apId),
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

    describe('canInteractWithAccount', () => {
        it('should return a boolean to indicate if the interaction account can interact with the target account', async () => {
            const [[aliceAccount], [bobAccount], [charlieAccount]] =
                await Promise.all([
                    fixtureManager.createInternalAccount(),
                    fixtureManager.createInternalAccount(),
                    fixtureManager.createInternalAccount(),
                ]);

            await fixtureManager.createBlock(aliceAccount, bobAccount);

            const bobCanInteractWithAlice =
                await moderationService.canInteractWithAccount(
                    bobAccount.id,
                    aliceAccount.id,
                );

            expect(bobCanInteractWithAlice).toBe(false);

            const charlieCanInteractWithAlice =
                await moderationService.canInteractWithAccount(
                    charlieAccount.id,
                    aliceAccount.id,
                );

            expect(charlieCanInteractWithAlice).toBe(true);
        });

        it('should prevent interaction when the domain is blocked', async () => {
            const [[aliceAccount], [bobAccount, bobSite]] = await Promise.all([
                fixtureManager.createInternalAccount(),
                fixtureManager.createInternalAccount(null, 'blocked.com'),
            ]);

            const [charlieAccount] =
                await fixtureManager.createInternalAccount(bobSite);

            await fixtureManager.createDomainBlock(
                aliceAccount,
                bobAccount.apId,
            );

            const bobCanInteractWithAlice =
                await moderationService.canInteractWithAccount(
                    bobAccount.id,
                    aliceAccount.id,
                );

            expect(bobCanInteractWithAlice).toBe(false);

            const charlieCanInteractWithAlice =
                await moderationService.canInteractWithAccount(
                    charlieAccount.id,
                    aliceAccount.id,
                );

            expect(charlieCanInteractWithAlice).toBe(false);
        });
    });
});
