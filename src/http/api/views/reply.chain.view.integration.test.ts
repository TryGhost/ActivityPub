import type { Knex } from 'knex';
import type { Post } from 'post/post.entity';
import { createTestDb } from 'test/db';
import { type FixtureManager, createFixtureManager } from 'test/fixtures';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ReplyChainView } from './reply.chain.view';

/**
 * This will setup the database with a bunch of posts centered around a single post.
 * The post will have an ancestor chain of MAX_ANCESTOR_DEPTH + 5 posts - to ensure pagination of ancestors
 * The post will have MAX_CHILDREN_COUNT + 5 replies - to ensure pagination of children
 * Each reply will have:
 *  - If it is even indexed, it will have a number of replies equal to its index - this covers the case where a reply has no chain
 *  - If it is odd indexed, it will have a reply chain of length equal to its index - this covers the case where a chain is paginated
 */
async function setupPosts(fixtureManager: FixtureManager) {
    const [account] = await fixtureManager.createInternalAccount();

    let postsToCreate = ReplyChainView.MAX_ANCESTOR_DEPTH + 6;
    const posts: Post[] = [];
    while (postsToCreate-- > 0) {
        const post = await fixtureManager.createPost(account, {
            inReplyTo: posts[posts.length - 1],
        });
        posts.push(post);
    }

    const ancestors = posts.slice(0, -1);
    const post = posts[posts.length - 1];

    let repliesToCreate = ReplyChainView.MAX_CHILDREN_COUNT + 5;
    const replies: Post[] = [];
    while (repliesToCreate-- > 0) {
        const reply = await fixtureManager.createPost(account, {
            inReplyTo: post,
        });
        replies.push(reply);
    }

    const chains: Post[][] = [];
    for (let i = 0; i < replies.length; i++) {
        const chain: Post[] = [];
        chains.push(chain);
        if (i % 2 === 0) {
            let replyCount = i;
            while (replyCount-- > 0) {
                await fixtureManager.createPost(account, {
                    inReplyTo: replies[i],
                });
            }
        } else {
            let replyToChain = replies[i];
            let chainLength = i;
            while (chainLength-- > 0) {
                replyToChain = await fixtureManager.createPost(account, {
                    inReplyTo: replyToChain,
                });
                chain.push(replyToChain);
            }
        }
    }

    return {
        ancestors,
        post,
        replies,
        chains,
    };
}

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
            const { ancestors, post } = await setupPosts(fixtureManager);

            const replyChainView = new ReplyChainView(db);
            // @ts-expect-error Property 'getAncestors' is private and only accessible within class 'ReplyChainView'
            const result = await replyChainView.getAncestors(
                post.author.id,
                post.apId,
            );

            expect(result).toHaveLength(ReplyChainView.MAX_ANCESTOR_DEPTH);
            expect(result[0].post_ap_id).toBe(
                ancestors[ancestors.length - ReplyChainView.MAX_ANCESTOR_DEPTH]
                    .apId.href,
            );

            // @ts-expect-error Property 'getAncestors' is private and only accessible within class 'ReplyChainView'
            const remainingAncestors = await replyChainView.getAncestors(
                post.author.id,
                new URL(result[0].post_ap_id),
            );

            expect(remainingAncestors).toHaveLength(5);
            expect(remainingAncestors[0].post_ap_id).toBe(
                ancestors[0].apId.href,
            );
        });
    });

    describe('getChildren', () => {
        it('should return the paginated children of a post with replies chain', async () => {
            const { post, replies, chains } = await setupPosts(fixtureManager);

            const replyChainView = new ReplyChainView(db);
            // @ts-expect-error Property 'getChildren' is private and only accessible within class 'ReplyChainView'
            const children = await replyChainView.getChildren(
                post.author.id,
                post.id!,
            );

            const expectedResults: string[] = [];

            for (let i = 0; i < ReplyChainView.MAX_CHILDREN_COUNT + 1; i++) {
                const child = replies[i];
                expectedResults.push(child.apId.href);
                const chain = chains[i];
                const expectedChain = chain
                    .slice(0, ReplyChainView.MAX_CHILDREN_DEPTH + 1)
                    .map((post) => post.apId.href);
                expectedResults.push(...expectedChain);
            }

            const resultIds = children.map((c) => c.post_ap_id);

            expect(resultIds).toEqual(expectedResults);
        });
    });
});
