import type { Knex } from 'knex';
import type { Post } from 'post/post.entity';
import { createTestDb } from 'test/db';
import { type FixtureManager, createFixtureManager } from 'test/fixtures';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ReplyChainView } from './reply.chain.view';

describe('ReplyChainView', () => {
    let db: Knex;
    let fixtureManager: FixtureManager;

    beforeAll(async () => {
        db = await createTestDb();
        fixtureManager = createFixtureManager(db);
    });

    beforeEach(async () => {
        await fixtureManager.reset();
    });

    describe('getAncestors', () => {
        it('should return the paginated ancestors of a post', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            let postsToCreate = ReplyChainView.MAX_ANCESTOR_DEPTH + 5;
            const posts: Post[] = [];
            while (postsToCreate-- > 0) {
                const post = await fixtureManager.createPost(account, {
                    inReplyTo: posts[posts.length - 1],
                });
                posts.push(post);
            }

            const allAncestors = posts.slice(0, -1);
            const lastPost = posts[posts.length - 1];

            const replyChainView = new ReplyChainView(db);
            // @ts-expect-error Property 'getAncestors' is private and only accessible within class 'ReplyChainView'
            const ancestors = await replyChainView.getAncestors(
                account.id,
                lastPost.apId,
            );

            expect(ancestors).toHaveLength(ReplyChainView.MAX_ANCESTOR_DEPTH);
            expect(ancestors[0].id).toBe(
                allAncestors[
                    allAncestors.length - ReplyChainView.MAX_ANCESTOR_DEPTH
                ].apId.href,
            );

            // @ts-expect-error Property 'getAncestors' is private and only accessible within class 'ReplyChainView'
            const remainingAncestors = await replyChainView.getAncestors(
                account.id,
                new URL(ancestors[0].id),
            );

            expect(remainingAncestors).toHaveLength(4);
            expect(remainingAncestors[0].id).toBe(allAncestors[0].apId.href);
        });
    });
});
