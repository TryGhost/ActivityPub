import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Knex } from 'knex';

import type { Account } from '@/account/account.entity';
import { GhostPostView } from '@/http/api/views/ghost-post.view';
import { PostType } from '@/post/post.entity';
import { createTestDb } from '@/test/db';
import { createFixtureManager, type FixtureManager } from '@/test/fixtures';

describe('GhostPostView', () => {
    let db: Knex;
    let fixtureManager: FixtureManager;
    let ghostPostView: GhostPostView;
    let account: Account;

    const ghostUuid = 'ee218320-b2e6-11ef-8a80-0242ac120002';

    beforeEach(async () => {
        db = await createTestDb();
        fixtureManager = createFixtureManager(db);
        ghostPostView = new GhostPostView(db);

        await fixtureManager.reset();

        [account] = await fixtureManager.createInternalAccount();
    });

    afterEach(async () => {
        await db.destroy();
    });

    describe('getApIdByGhostUuid', () => {
        it('should return the AP id of the post mapped to the Ghost UUID', async () => {
            const post = await fixtureManager.createPost(account, {
                type: PostType.Article,
            });

            await db('ghost_ap_post_mappings').insert({
                ghost_uuid: ghostUuid,
                ap_id: post.apId.href,
            });

            const result = await ghostPostView.getApIdByGhostUuid(
                ghostUuid,
                account.id,
            );

            expect(result).toBe(post.apId.href);
        });

        it('should return null if there is no mapping for the Ghost UUID', async () => {
            const result = await ghostPostView.getApIdByGhostUuid(
                ghostUuid,
                account.id,
            );

            expect(result).toBeNull();
        });

        it('should return null if the post does not belong to the account', async () => {
            const post = await fixtureManager.createPost(account, {
                type: PostType.Article,
            });

            await db('ghost_ap_post_mappings').insert({
                ghost_uuid: ghostUuid,
                ap_id: post.apId.href,
            });

            const [otherAccount] = await fixtureManager.createInternalAccount();

            const result = await ghostPostView.getApIdByGhostUuid(
                ghostUuid,
                otherAccount.id,
            );

            expect(result).toBeNull();
        });

        it('should return null if the post has been deleted', async () => {
            const post = await fixtureManager.createPost(account, {
                type: PostType.Article,
            });

            await db('ghost_ap_post_mappings').insert({
                ghost_uuid: ghostUuid,
                ap_id: post.apId.href,
            });

            await db('posts')
                .where('id', post.id)
                .update({ deleted_at: new Date() });

            const result = await ghostPostView.getApIdByGhostUuid(
                ghostUuid,
                account.id,
            );

            expect(result).toBeNull();
        });
    });
});
