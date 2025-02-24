import type EventEmitter from 'node:events';
import type { Knex } from 'knex';

import { randomUUID } from 'node:crypto';
import { Account } from '../account/account.entity';
import { TABLE_LIKES, TABLE_POSTS, TABLE_REPOSTS } from '../constants';
import { parseURL } from '../core/url';
import { PostCreatedEvent } from './post-created.event';
import { PostRepostedEvent } from './post-reposted.event';
import { Post } from './post.entity';

export class KnexPostRepository {
    constructor(
        private readonly db: Knex,
        private readonly events: EventEmitter,
    ) {}

    async getByApId(apId: URL): Promise<Post | null> {
        const row = await this.db(TABLE_POSTS)
            .join('accounts', 'accounts.id', 'posts.author_id')
            .whereRaw('ap_id_hash = UNHEX(SHA2(?, 256))', [apId.href])
            .select(
                'posts.id',
                'posts.uuid',
                'posts.type',
                'posts.audience',
                'posts.title',
                'posts.excerpt',
                'posts.content',
                'posts.url',
                'posts.image_url',
                'posts.published_at',
                'posts.like_count',
                'posts.repost_count',
                'posts.reply_count',
                'posts.reading_time_minutes',
                'posts.author_id',
                'posts.ap_id',
                'posts.in_reply_to',
                'posts.thread_root',
                'accounts.username',
                'accounts.uuid as author_uuid',
                'accounts.name',
                'accounts.bio',
                'accounts.avatar_url',
                'accounts.banner_image_url',
            )
            .first();

        if (!row) {
            return null;
        }

        if (!row.author_uuid) {
            row.author_uuid = randomUUID();
            await this.db('accounts')
                .update({ uuid: row.author_uuid })
                .where({ id: row.author_id });
        }

        const author = new Account(
            row.author_id,
            row.author_uuid,
            row.username,
            row.name,
            row.bio,
            parseURL(row.avatar_url),
            parseURL(row.banner_image_url),
            null,
        );

        const post = new Post(
            row.id,
            row.uuid,
            author,
            row.type,
            row.audience,
            row.title,
            row.excerpt,
            row.content,
            new URL(row.url),
            parseURL(row.image_url),
            new Date(row.published_at),
            row.like_count,
            row.repost_count,
            row.reply_count,
            row.in_reply_to,
            row.thread_root,
            row.reading_time_minutes,
            new URL(row.ap_id),
        );

        return post;
    }

    /**
     * Save a post to the database
     *
     * @param post Post to save
     */
    async save(post: Post): Promise<void> {
        const transaction = await this.db.transaction();
        const isNewPost = post.isNew;

        try {
            const { likesToAdd, likesToRemove } = post.getChangedLikes();
            const { repostsToAdd, repostsToRemove } = post.getChangedReposts();
            let repostAccountIds: number[] = [];

            if (isNewPost) {
                const postId = await this.insertPost(
                    post,
                    likesToAdd.length,
                    repostsToAdd.length,
                    transaction,
                );

                if (post.inReplyTo) {
                    await transaction(TABLE_POSTS)
                        .update({
                            reply_count: this.db.raw('reply_count + 1'),
                        })
                        .where({ id: post.inReplyTo });
                }

                // Hacks? Mutate the Post so `isNew` returns false.
                (post as any).id = postId;

                if (likesToAdd.length > 0) {
                    await this.insertLikes(post, likesToAdd, transaction);
                }

                if (repostsToAdd.length > 0) {
                    await this.insertReposts(post, repostsToAdd, transaction);

                    repostAccountIds = repostsToAdd.map(
                        (accountId) => accountId,
                    );
                }
            } else {
                if (likesToAdd.length > 0 || likesToRemove.length > 0) {
                    const insertedLikesCount =
                        likesToAdd.length > 0
                            ? await this.insertLikesIgnoringDuplicates(
                                  post,
                                  likesToAdd,
                                  transaction,
                              )
                            : 0;

                    const removedLikesCount =
                        likesToRemove.length > 0
                            ? await this.removeLikes(
                                  post,
                                  likesToRemove,
                                  transaction,
                              )
                            : 0;

                    if (insertedLikesCount - removedLikesCount !== 0) {
                        await transaction(TABLE_POSTS)
                            .update({
                                like_count: transaction.raw(
                                    `like_count + ${insertedLikesCount - removedLikesCount}`,
                                ),
                            })
                            .where({ id: post.id });
                    }
                }

                if (repostsToAdd.length > 0 || repostsToRemove.length > 0) {
                    const { insertedRepostsCount, accountIdsInserted } =
                        repostsToAdd.length > 0
                            ? await this.insertRepostsIgnoringDuplicates(
                                  post,
                                  repostsToAdd,
                                  transaction,
                              )
                            : {
                                  insertedRepostsCount: 0,
                                  accountIdsInserted: [],
                              };

                    const removedRepostsCount =
                        repostsToRemove.length > 0
                            ? await this.removeReposts(
                                  post,
                                  repostsToRemove,
                                  transaction,
                              )
                            : 0;

                    repostAccountIds = accountIdsInserted.filter(
                        (accountId) => !repostsToRemove.includes(accountId),
                    );

                    if (insertedRepostsCount - removedRepostsCount !== 0) {
                        await transaction(TABLE_POSTS)
                            .update({
                                repost_count: transaction.raw(
                                    `repost_count + ${insertedRepostsCount - removedRepostsCount}`,
                                ),
                            })
                            .where({ id: post.id });
                    }
                }
            }

            await transaction.commit();

            if (isNewPost) {
                this.events.emit(
                    PostCreatedEvent.getName(),
                    new PostCreatedEvent(post),
                );
            }

            for (const accountId of repostAccountIds) {
                this.events.emit(
                    PostRepostedEvent.getName(),
                    new PostRepostedEvent(post, accountId),
                );
            }
        } catch (err) {
            await transaction.rollback();

            throw err;
        }
    }

    /**
     * Insert a post into the database
     *
     * @param post Post to insert
     * @param likeCount Number of likes the post has
     * @param repostCount Number of reposts the post has
     * @param transaction Database transaction to use
     * @returns ID of the inserted post
     */
    private async insertPost(
        post: Post,
        likeCount: number,
        repostCount: number,
        transaction: Knex.Transaction,
    ) {
        const [id] = await transaction(TABLE_POSTS).insert({
            uuid: post.uuid,
            type: post.type,
            audience: post.audience,
            author_id: post.author.id,
            title: post.title,
            excerpt: post.excerpt,
            content: post.content,
            url: post.url?.href,
            image_url: post.imageUrl?.href,
            published_at: post.publishedAt,
            in_reply_to: post.inReplyTo,
            thread_root: post.threadRoot,
            like_count: likeCount,
            repost_count: repostCount,
            reply_count: 0,
            reading_time_minutes: post.readingTime,
            ap_id: post.apId.href,
        });

        return id;
    }

    /**
     * Insert likes of a post into the database
     *
     * @param post Post to insert likes for
     * @param likeAccountIds Account IDs to insert likes for
     * @param transaction Database transaction to use
     */
    private async insertLikes(
        post: Post,
        likeAccountIds: number[],
        transaction: Knex.Transaction,
    ) {
        const likesToInsert = likeAccountIds.map((accountId) => ({
            account_id: accountId,
            post_id: post.id,
        }));

        await transaction(TABLE_LIKES).insert(likesToInsert);
    }

    /**
     * Remove likes of a post from the database
     *
     * @param post Post to remove likes for
     * @param accountIds Account IDs to remove likes for
     * @param transaction Database transaction to use
     */
    private async removeLikes(
        post: Post,
        accountIds: number[],
        transaction: Knex.Transaction,
    ): Promise<number> {
        return await transaction(TABLE_LIKES)
            .where({
                post_id: post.id,
            })
            .whereIn('account_id', accountIds)
            .del();
    }

    /**
     * Insert likes of a post into the database, ignoring
     * duplicates
     *
     * @param post Post to insert likes for
     * @param likeAccountIds Account IDs to insert likes for
     * @param transaction Database transaction to use
     * @returns Number of likes inserted
     */
    private async insertLikesIgnoringDuplicates(
        post: Post,
        likeAccountIds: number[],
        transaction: Knex.Transaction,
    ): Promise<number> {
        const likesToInsert = likeAccountIds.map((accountId) => ({
            account_id: accountId,
            post_id: post.id,
        }));

        await transaction(TABLE_LIKES)
            .insert(likesToInsert)
            .onConflict()
            .ignore();

        const [[{ count }]] = await transaction.raw(
            'SELECT ROW_COUNT() as count',
        );

        return count;
    }

    /**
     * Insert reposts of a post into the database
     *
     * @param post Post to insert reposts for
     * @param repostAccountIds Account IDs to insert reposts for
     * @param transaction Database transaction to use
     */
    private async insertReposts(
        post: Post,
        repostAccountIds: number[],
        transaction: Knex.Transaction,
    ) {
        const repostsToInsert = repostAccountIds.map((accountId) => ({
            account_id: accountId,
            post_id: post.id,
        }));

        await transaction(TABLE_REPOSTS).insert(repostsToInsert);
    }

    /**
     * Remove reposts of a post from the database
     *
     * @param post Post to remove reposts for
     * @param accountIds Account IDs to remove reposts for
     * @param transaction Database transaction to use
     * @returns The number of reposts removed
     */
    private async removeReposts(
        post: Post,
        accountIds: number[],
        transaction: Knex.Transaction,
    ): Promise<number> {
        return await transaction(TABLE_REPOSTS)
            .where({
                post_id: post.id,
            })
            .whereIn('account_id', accountIds)
            .del();
    }

    /**
     * Insert reposts of a post into the database, ignoring
     * duplicates
     *
     * @param post Post to insert reposts for
     * @param repostAccountIds Account IDs to insert reposts for
     * @param transaction Database transaction to use
     * @returns The number of reposts inserted and the account IDs of the
     * reposts that were inserted
     */
    private async insertRepostsIgnoringDuplicates(
        post: Post,
        repostAccountIds: number[],
        transaction: Knex.Transaction,
    ): Promise<{ insertedRepostsCount: number; accountIdsInserted: number[] }> {
        // Retrieve the account IDs of the reposts that are already in the
        // database - This is so we can report exactly which reposts were
        // inserted so that we do not emit events for reposts that were
        // already in the database
        const currentRepostAccountIds = (
            await transaction(TABLE_REPOSTS)
                .where('post_id', post.id)
                .select('account_id')
        ).map((row) => row.account_id);

        const newRepostAccountIds = repostAccountIds.filter(
            (accountId) => !currentRepostAccountIds.includes(accountId),
        );

        if (newRepostAccountIds.length === 0) {
            return {
                insertedRepostsCount: 0,
                accountIdsInserted: [],
            };
        }

        const repostsToInsert = newRepostAccountIds.map((accountId) => ({
            account_id: accountId,
            post_id: post.id,
        }));

        await transaction(TABLE_REPOSTS)
            .insert(repostsToInsert)
            .onConflict()
            .ignore();

        const [[{ count }]] = await transaction.raw(
            'SELECT ROW_COUNT() as count',
        );

        return {
            insertedRepostsCount: count,
            accountIdsInserted: newRepostAccountIds,
        };
    }
}
