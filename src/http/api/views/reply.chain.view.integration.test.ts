import { unsafeUnwrap } from 'core/result';
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

        it('should be able to return the next page of children', async () => {
            const { ancestors, post, replies, chains } =
                await setupPosts(fixtureManager);

            const replyChainView = new ReplyChainView(db);

            // @ts-expect-error Property 'getChildren' is private and only accessible within class 'ReplyChainView'
            const children = await replyChainView.getChildren(
                post.author.id,
                post.id!,
            );

            const topLevelChildrenFromFirstPage = children.filter(
                (c) => c.post_in_reply_to === post.id,
            );
            const lastChild =
                topLevelChildrenFromFirstPage[
                    topLevelChildrenFromFirstPage.length - 1
                ];

            const cursor = lastChild.post_published_at;

            // @ts-expect-error Property 'getChildren' is private and only accessible within class 'ReplyChainView'
            const nextChildren = await replyChainView.getChildren(
                post.author.id,
                post.id!,
                cursor.toISOString(),
            );

            const topLevelChildrenFromSecondPage = nextChildren.filter(
                (c) => c.post_in_reply_to === post.id,
            );

            expect(
                topLevelChildrenFromFirstPage.length +
                    topLevelChildrenFromSecondPage.length,
            ).toBe(15);

            const expectedIds = replies.map((r) => r.apId.href);
            const resultIds = topLevelChildrenFromFirstPage
                .map((c) => c.post_ap_id)
                .concat(
                    topLevelChildrenFromSecondPage.map((c) => c.post_ap_id),
                );

            expect(resultIds).toEqual(expectedIds);
        });
    });

    describe('getReplyChain', () => {
        it('should return the reply chain for a post', async () => {
            const { post } = await setupPosts(fixtureManager);

            const replyChainView = new ReplyChainView(db);

            const replyChainResult = await replyChainView.getReplyChain(
                post.author.id,
                post.apId,
            );

            const replyChain = unsafeUnwrap(replyChainResult);

            expect(replyChain.ancestors.chain).toHaveLength(
                ReplyChainView.MAX_ANCESTOR_DEPTH,
            );
            expect(replyChain.children).toHaveLength(
                ReplyChainView.MAX_CHILDREN_COUNT,
            );
        });

        it('should correctly set hasMore for ancestors when there are more ancestors', async () => {
            const { ancestors, post } = await setupPosts(fixtureManager);

            const replyChainView = new ReplyChainView(db);

            const replyChainResult = await replyChainView.getReplyChain(
                post.author.id,
                post.apId,
            );

            const replyChain = unsafeUnwrap(replyChainResult);

            // We created MAX_ANCESTOR_DEPTH + 5 ancestors, but only MAX_ANCESTOR_DEPTH are returned
            expect(replyChain.ancestors.chain).toHaveLength(
                ReplyChainView.MAX_ANCESTOR_DEPTH,
            );
            expect(replyChain.ancestors.hasMore).toBe(true);

            // Verify the ancestors are in the correct order (oldest to newest)
            const expectedAncestorIds = ancestors
                .slice(-ReplyChainView.MAX_ANCESTOR_DEPTH)
                .map((a) => a.apId.href);
            const actualAncestorIds = replyChain.ancestors.chain.map(
                (a) => a.id,
            );
            expect(actualAncestorIds).toEqual(expectedAncestorIds);
        });

        it('should correctly set hasMore for ancestors when there are no more ancestors', async () => {
            const { ancestors } = await setupPosts(fixtureManager);

            const replyChainView = new ReplyChainView(db);

            // Get the reply chain for the oldest ancestor (which has no parent)
            const oldestAncestor = ancestors[0];
            const replyChainResult = await replyChainView.getReplyChain(
                oldestAncestor.author.id,
                oldestAncestor.apId,
            );

            const replyChain = unsafeUnwrap(replyChainResult);

            expect(replyChain.ancestors.chain).toHaveLength(0);
            expect(replyChain.ancestors.hasMore).toBe(false);
        });

        it('should correctly set hasMore for children chains', async () => {
            const { post, replies, chains } = await setupPosts(fixtureManager);

            const replyChainView = new ReplyChainView(db);

            const replyChainResult = await replyChainView.getReplyChain(
                post.author.id,
                post.apId,
            );

            const replyChain = unsafeUnwrap(replyChainResult);

            // Check children with different chain lengths
            for (let i = 0; i < replyChain.children.length; i++) {
                const child = replyChain.children[i];
                const expectedReply = replies[i];
                const expectedChain = chains[i];

                expect(child.post.id).toBe(expectedReply.apId.href);

                if (i % 2 === 0) {
                    // Even indexed replies have no chain
                    expect(child.chain).toHaveLength(0);
                    expect(child.hasMore).toBe(false);
                } else {
                    // Odd indexed replies have a chain of length equal to their index
                    const expectedChainLength = Math.min(
                        i,
                        ReplyChainView.MAX_CHILDREN_DEPTH,
                    );
                    expect(child.chain).toHaveLength(expectedChainLength);

                    // hasMore should be true if the chain is longer than MAX_CHILDREN_DEPTH
                    expect(child.hasMore).toBe(
                        i > ReplyChainView.MAX_CHILDREN_DEPTH,
                    );

                    // Verify the chain posts are correct
                    const actualChainIds = child.chain.map((c) => c.id);
                    const expectedChainIds = expectedChain
                        .slice(0, expectedChainLength)
                        .map((c) => c.apId.href);
                    expect(actualChainIds).toEqual(expectedChainIds);
                }
            }
        });

        it('should correctly set next cursor when there are more children', async () => {
            const { post, replies } = await setupPosts(fixtureManager);

            const replyChainView = new ReplyChainView(db);

            const replyChainResult = await replyChainView.getReplyChain(
                post.author.id,
                post.apId,
            );

            const replyChain = unsafeUnwrap(replyChainResult);

            // We created MAX_CHILDREN_COUNT + 5 children, so there should be a next cursor
            expect(replyChain.next).not.toBeNull();
            expect(replyChain.next).toBe(
                replyChain.children[
                    replyChain.children.length - 1
                ].post.publishedAt.toISOString(),
            );
        });

        it('should correctly paginate through all children', async () => {
            const { post, replies } = await setupPosts(fixtureManager);

            const replyChainView = new ReplyChainView(db);

            // Get first page
            const firstPageResult = await replyChainView.getReplyChain(
                post.author.id,
                post.apId,
            );
            const firstPage = unsafeUnwrap(firstPageResult);

            expect(firstPage.children).toHaveLength(
                ReplyChainView.MAX_CHILDREN_COUNT,
            );
            expect(firstPage.next).not.toBeNull();

            // Get second page
            const secondPageResult = await replyChainView.getReplyChain(
                post.author.id,
                post.apId,
                firstPage.next!,
            );
            const secondPage = unsafeUnwrap(secondPageResult);

            // Should have the remaining 5 children
            expect(secondPage.children).toHaveLength(5);
            expect(secondPage.next).toBeNull();

            // Verify all children are accounted for
            const allChildrenIds = [
                ...firstPage.children.map((c) => c.post.id),
                ...secondPage.children.map((c) => c.post.id),
            ];
            const expectedChildrenIds = replies.map((r) => r.apId.href);
            expect(allChildrenIds).toEqual(expectedChildrenIds);

            // Verify ancestors are the same in both pages
            expect(secondPage.ancestors.chain).toEqual(
                firstPage.ancestors.chain,
            );
            expect(secondPage.ancestors.hasMore).toBe(
                firstPage.ancestors.hasMore,
            );
        });

        it('should handle posts with no children', async () => {
            const { chains } = await setupPosts(fixtureManager);

            const replyChainView = new ReplyChainView(db);

            // Get a post from deep in a chain that has no children
            const leafPost = chains[1][chains[1].length - 1];

            const replyChainResult = await replyChainView.getReplyChain(
                leafPost.author.id,
                leafPost.apId,
            );

            const replyChain = unsafeUnwrap(replyChainResult);

            expect(replyChain.children).toHaveLength(0);
            expect(replyChain.next).toBeNull();
            expect(replyChain.ancestors.chain.length).toBeGreaterThan(0);
            expect(replyChain.ancestors.hasMore).toBe(true);
        });

        it('should handle posts in the middle of a chain', async () => {
            const { replies, chains } = await setupPosts(fixtureManager);

            const replyChainView = new ReplyChainView(db);

            // Get a post from the middle of a chain (chain index 7, post 3 in the chain)
            const middlePost = chains[7][2];

            const replyChainResult = await replyChainView.getReplyChain(
                middlePost.author.id,
                middlePost.apId,
            );

            const replyChain = unsafeUnwrap(replyChainResult);

            // Should have ancestors up to MAX_ANCESTOR_DEPTH
            expect(replyChain.ancestors.chain.length).toBeGreaterThan(0);
            expect(replyChain.ancestors.hasMore).toBe(true);

            // Should have exactly one child (the next post in the chain)
            expect(replyChain.children).toHaveLength(1);
            expect(replyChain.children[0].post.id).toBe(chains[7][3].apId.href);

            // The child should have its own chain
            expect(replyChain.children[0].chain.length).toBeGreaterThan(0);
            expect(replyChain.children[0].hasMore).toBe(false); // Chain 7 has 7 posts, post 3 has 3 more in chain
        });

        it('should return not-found error for non-existent post', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            const replyChainView = new ReplyChainView(db);

            const replyChainResult = await replyChainView.getReplyChain(
                account.id,
                new URL('https://example.com/non-existent-post'),
            );

            expect(replyChainResult).toEqual(['not-found', null]);
        });

        it('should return deleted posts as tombstones in ancestors', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            // Create a chain of posts
            const post1 = await fixtureManager.createPost(account);
            const post2 = await fixtureManager.createPost(account, {
                inReplyTo: post1,
            });
            const post3 = await fixtureManager.createPost(account, {
                inReplyTo: post2,
            });
            const post4 = await fixtureManager.createPost(account, {
                inReplyTo: post3,
            });

            // Delete post2
            await db('posts')
                .where({ id: post2.id })
                .update({ deleted_at: new Date() });

            const replyChainView = new ReplyChainView(db);
            const replyChainResult = await replyChainView.getReplyChain(
                account.id,
                post4.apId,
            );

            const replyChain = unsafeUnwrap(replyChainResult);

            // Should include all ancestors, with deleted post as tombstone
            const ancestorIds = replyChain.ancestors.chain.map((a) => a.id);
            expect(ancestorIds).toContain(post1.apId.href);
            expect(ancestorIds).toContain(post2.apId.href);
            expect(ancestorIds).toContain(post3.apId.href);

            // Find the deleted post (post2) in the ancestors
            const deletedAncestor = replyChain.ancestors.chain.find(
                (a) => a.id === post2.apId.href,
            );

            // Verify it's a tombstone
            expect(deletedAncestor).toBeDefined();
            expect(deletedAncestor!.type).toBe(2); // PostType.Tombstone
            expect(deletedAncestor!.title).toBe('');
            expect(deletedAncestor!.content).toBe('');
            expect(deletedAncestor!.excerpt).toBe('');
            expect(deletedAncestor!.summary).toBeNull();
            expect(deletedAncestor!.featureImageUrl).toBeNull();
            expect(deletedAncestor!.attachments).toEqual([]);
        });

        it('should not include deleted posts in children', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            const post = await fixtureManager.createPost(account);
            const reply1 = await fixtureManager.createPost(account, {
                inReplyTo: post,
            });
            const reply2 = await fixtureManager.createPost(account, {
                inReplyTo: post,
            });
            const reply3 = await fixtureManager.createPost(account, {
                inReplyTo: post,
            });

            // Delete reply2
            await db('posts')
                .where({ id: reply2.id })
                .update({ deleted_at: new Date() });

            const replyChainView = new ReplyChainView(db);
            const replyChainResult = await replyChainView.getReplyChain(
                account.id,
                post.apId,
            );

            const replyChain = unsafeUnwrap(replyChainResult);

            // Should only include non-deleted children
            const childIds = replyChain.children.map((c) => c.post.id);
            expect(childIds).toContain(reply1.apId.href);
            expect(childIds).not.toContain(reply2.apId.href);
            expect(childIds).toContain(reply3.apId.href);
            expect(replyChain.children).toHaveLength(2);
        });

        it('should not include deleted posts in reply chains', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            const post = await fixtureManager.createPost(account);
            const reply = await fixtureManager.createPost(account, {
                inReplyTo: post,
            });
            const chainPost1 = await fixtureManager.createPost(account, {
                inReplyTo: reply,
            });
            const chainPost2 = await fixtureManager.createPost(account, {
                inReplyTo: chainPost1,
            });
            const chainPost3 = await fixtureManager.createPost(account, {
                inReplyTo: chainPost2,
            });

            // Delete chainPost2
            await db('posts')
                .where({ id: chainPost2.id })
                .update({ deleted_at: new Date() });

            const replyChainView = new ReplyChainView(db);
            const replyChainResult = await replyChainView.getReplyChain(
                account.id,
                post.apId,
            );

            const replyChain = unsafeUnwrap(replyChainResult);

            // Should have the reply as a child
            expect(replyChain.children).toHaveLength(1);
            expect(replyChain.children[0].post.id).toBe(reply.apId.href);

            // The chain should only include non-deleted posts
            const chainIds = replyChain.children[0].chain.map((c) => c.id);
            expect(chainIds).toContain(chainPost1.apId.href);
            expect(chainIds).not.toContain(chainPost2.apId.href);
            // chainPost3 should not be included because its parent (chainPost2) is deleted
            expect(chainIds).not.toContain(chainPost3.apId.href);
        });

        it('should handle deleted posts at the beginning of a chain', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            const post = await fixtureManager.createPost(account);
            const reply = await fixtureManager.createPost(account, {
                inReplyTo: post,
            });
            const chainPost1 = await fixtureManager.createPost(account, {
                inReplyTo: reply,
            });
            const chainPost2 = await fixtureManager.createPost(account, {
                inReplyTo: chainPost1,
            });

            // Delete the first post in the chain
            await db('posts')
                .where({ id: reply.id })
                .update({ deleted_at: new Date() });

            const replyChainView = new ReplyChainView(db);
            const replyChainResult = await replyChainView.getReplyChain(
                account.id,
                post.apId,
            );

            const replyChain = unsafeUnwrap(replyChainResult);

            // Should not include the deleted reply or its chain
            const childIds = replyChain.children.map((c) => c.post.id);
            expect(childIds).not.toContain(reply.apId.href);
            expect(childIds).not.toContain(chainPost1.apId.href);
            expect(childIds).not.toContain(chainPost2.apId.href);
            expect(replyChain.children).toHaveLength(0);
        });

        it('should return not-found error when querying a deleted post', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            const post = await fixtureManager.createPost(account);

            // Delete the post
            await db('posts')
                .where({ id: post.id })
                .update({ deleted_at: new Date() });

            const replyChainView = new ReplyChainView(db);
            const replyChainResult = await replyChainView.getReplyChain(
                account.id,
                post.apId,
            );

            expect(replyChainResult).toEqual(['not-found', null]);
        });

        it('should correctly handle pagination with deleted posts', async () => {
            const [account] = await fixtureManager.createInternalAccount();

            const post = await fixtureManager.createPost(account);
            const replies: Post[] = [];

            // Create 15 replies
            for (let i = 0; i < 15; i++) {
                const reply = await fixtureManager.createPost(account, {
                    inReplyTo: post,
                });
                replies.push(reply);
            }

            // Delete some replies (indices 2, 5, 8, 11)
            const indicesToDelete = [2, 5, 8, 11];
            for (const index of indicesToDelete) {
                await db('posts')
                    .where({ id: replies[index].id })
                    .update({ deleted_at: new Date() });
            }

            const replyChainView = new ReplyChainView(db);

            // Get first page
            const firstPageResult = await replyChainView.getReplyChain(
                account.id,
                post.apId,
            );
            const firstPage = unsafeUnwrap(firstPageResult);

            // Should have MAX_CHILDREN_COUNT non-deleted children
            expect(firstPage.children).toHaveLength(
                ReplyChainView.MAX_CHILDREN_COUNT,
            );

            // Verify none of the children are deleted posts
            const firstPageIds = firstPage.children.map((c) => c.post.id);
            for (const index of indicesToDelete) {
                expect(firstPageIds).not.toContain(replies[index].apId.href);
            }

            // Get second page
            const secondPageResult = await replyChainView.getReplyChain(
                account.id,
                post.apId,
                firstPage.next!,
            );
            const secondPage = unsafeUnwrap(secondPageResult);

            // Should have the remaining non-deleted children (15 - 4 deleted - 10 from first page = 1)
            expect(secondPage.children).toHaveLength(1);

            // Verify all non-deleted replies are accounted for
            const allChildrenIds = [
                ...firstPageIds,
                ...secondPage.children.map((c) => c.post.id),
            ];
            expect(allChildrenIds).toHaveLength(11); // 15 - 4 deleted

            // Verify deleted replies are not included
            for (const index of indicesToDelete) {
                expect(allChildrenIds).not.toContain(replies[index].apId.href);
            }
        });
    });
});
