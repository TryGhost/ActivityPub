import type { Knex } from 'knex';
import { createTestDb } from 'test/db';
import { type FixtureManager, createFixtureManager } from 'test/fixtures';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BlocksView } from './blocks.view';

describe('BlocksView', () => {
    let db: Knex;
    let fixtureManager: FixtureManager;
    let blocksView: BlocksView;

    beforeAll(async () => {
        db = await createTestDb();
        fixtureManager = await createFixtureManager(db);
    });

    beforeEach(async () => {
        blocksView = new BlocksView(db);
    });

    afterAll(async () => {
        await db.destroy();
    });

    describe('getBlockedAccounts', () => {
        it('should return empty array when no accounts are blocked', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            const blockedAccounts = await blocksView.getBlockedAccounts(
                account.id,
            );

            expect(blockedAccounts).toEqual([]);
        });

        it('should return blocked accounts', async () => {
            const [blocker] = await fixtureManager.createInternalAccount();
            const [blockedOne] = await fixtureManager.createInternalAccount();
            const [blockedTwo] = await fixtureManager.createInternalAccount();

            await fixtureManager.createBlock(blocker, blockedOne);
            await fixtureManager.createBlock(blocker, blockedTwo);
            await fixtureManager.createDomainBlock(blocker, blockedTwo.apId);

            const blockedAccounts = await blocksView.getBlockedAccounts(
                blocker.id,
            );

            expect(blockedAccounts).toHaveLength(2);
            expect(blockedAccounts[0]).toEqual({
                id: blockedOne.apId.toString(),
                apId: blockedOne.apId.toString(),
                name: blockedOne.name,
                handle: `@${blockedOne.username}@${blockedOne.apId.host}`,
                avatarUrl: blockedOne.avatarUrl
                    ? blockedOne.avatarUrl.toString()
                    : null,
                followedByMe: false,
                blockedByMe: true,
                domainBlockedByMe: false,
                isFollowing: false,
            });
            expect(blockedAccounts[1]).toEqual({
                id: blockedTwo.apId.toString(),
                apId: blockedTwo.apId.toString(),
                name: blockedTwo.name,
                handle: `@${blockedTwo.username}@${blockedTwo.apId.host}`,
                avatarUrl: blockedTwo.avatarUrl
                    ? blockedTwo.avatarUrl.toString()
                    : null,
                followedByMe: false,
                blockedByMe: true,
                domainBlockedByMe: true,
                isFollowing: false,
            });
        });
    });

    describe('getBlockedDomains', () => {
        it('should return empty array when no domains are blocked', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            const blockedDomains = await blocksView.getBlockedDomains(
                account.id,
            );

            expect(blockedDomains).toEqual([]);
        });

        it('should return blocked domains', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            await fixtureManager.createDomainBlock(
                account,
                new URL('https://example.com'),
            );

            const blockedDomains = await blocksView.getBlockedDomains(
                account.id,
            );

            expect(blockedDomains).toHaveLength(1);
            expect(blockedDomains[0]).toEqual({
                url: 'https://example.com',
            });
        });
    });
});
