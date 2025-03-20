import type { Knex } from 'knex';

import { randomUUID } from 'node:crypto';
import type { AsyncEvents } from 'core/events';
import { Account, type AccountSite } from '../account/account.entity';
import { TABLE_LIKES, TABLE_POSTS, TABLE_REPOSTS } from '../constants';
import { parseURL } from '../core/url';
import { PostCreatedEvent } from './post-created.event';
import { PostDeletedEvent } from './post-deleted.event';
import { PostDerepostedEvent } from './post-dereposted.event';
import { PostRepostedEvent } from './post-reposted.event';
import { Post } from './post.entity';

type ThreadPosts = {
    post: Post;
    likedByAccount: boolean;
    repostedByAccount: boolean;
}[];

export class KnexPostRepository {
    constructor(
        private readonly db: Knex,
        private readonly events: AsyncEvents,
    ) {}

    async getById(id: Post['id']): Promise<Post | null> {
        const row = await this.db(TABLE_POSTS)
            .join('accounts', 'accounts.id', 'posts.author_id')
            .leftJoin('users', 'users.account_id', 'accounts.id')
            .leftJoin('sites', 'sites.id', 'users.site_id')
            .where('posts.id', id)
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
                'posts.attachments',
                'posts.author_id',
                'posts.ap_id',
                'posts.in_reply_to',
                'posts.thread_root',
                'posts.deleted_at',
                'accounts.username',
                'accounts.uuid as author_uuid',
                'accounts.name',
                'accounts.bio',
                'accounts.avatar_url',
                'accounts.banner_image_url',
                'accounts.ap_id as author_ap_id',
                'accounts.url as author_url',
                'accounts.ap_followers_url as author_ap_followers_url',
                'sites.id as site_id',
                'sites.host as site_host',
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

        let site: AccountSite | null = null;

        if (
            typeof row.site_id === 'number' &&
            typeof row.site_host === 'string'
        ) {
            site = {
                id: row.site_id,
                host: row.site_host,
            };
        }

        const author = new Account(
            row.author_id,
            row.author_uuid,
            row.username,
            row.name,
            row.bio,
            parseURL(row.avatar_url),
            parseURL(row.banner_image_url),
            site,
            parseURL(row.author_ap_id),
            parseURL(row.author_url),
            parseURL(row.author_ap_followers_url),
        );

        // Parse attachments and convert URL strings back to URL objects
        const attachments = row.attachments
            ? row.attachments.map((attachment: any) => ({
                  ...attachment,
                  url: new URL(attachment.url),
              }))
            : [];

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
            attachments,
            new URL(row.ap_id),
            row.deleted_at !== null,
        );

        return post;
    }

    async getByApId(apId: URL): Promise<Post | null> {
        const row = await this.db(TABLE_POSTS)
            .join('accounts', 'accounts.id', 'posts.author_id')
            .leftJoin('users', 'users.account_id', 'accounts.id')
            .leftJoin('sites', 'sites.id', 'users.site_id')
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
                'posts.attachments',
                'posts.author_id',
                'posts.ap_id',
                'posts.in_reply_to',
                'posts.thread_root',
                'posts.deleted_at',
                'accounts.username',
                'accounts.uuid as author_uuid',
                'accounts.name',
                'accounts.bio',
                'accounts.avatar_url',
                'accounts.banner_image_url',
                'accounts.ap_id as author_ap_id',
                'accounts.url as author_url',
                'accounts.ap_followers_url as author_ap_followers_url',
                'sites.id as site_id',
                'sites.host as site_host',
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

        let site: AccountSite | null = null;

        if (
            typeof row.site_id === 'number' &&
            typeof row.site_host === 'string'
        ) {
            site = {
                id: row.site_id,
                host: row.site_host,
            };
        }

        const author = new Account(
            row.author_id,
            row.author_uuid,
            row.username,
            row.name,
            row.bio,
            parseURL(row.avatar_url),
            parseURL(row.banner_image_url),
            site,
            parseURL(row.author_ap_id),
            parseURL(row.author_url),
            parseURL(row.author_ap_followers_url),
        );

        // Parse attachments and convert URL strings back to URL objects
        const attachments = row.attachments
            ? row.attachments.map((attachment: any) => ({
                  ...attachment,
                  url: new URL(attachment.url),
              }))
            : [];

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
            attachments,
            new URL(row.ap_id),
            row.deleted_at !== null,
        );

        return post;
    }

    /**
     * Get a thread of posts by AP ID
     *
     * A thread should include all ancestors (the entire chain of parent posts)
     * and all immediate children (direct replies) of the given post
     *
     * For example, if we have the following posts:
     *
     * ```text
     * POST 1
     * POST 1.1 (child of POST 1)
     * POST 1.2 (child of POST 1)
     * POST 1.2.1 (child of POST 1.2)
     * POST 1.2.2 (child of POST 1.2)
     * POST 1.2.2.1 (child of POST 1.2.2)
     * POST 1.2.3 (child of POST 1.2)
     * POST 2
     * POST 2.1 (child of POST 2)
     * POST 2.1.1 (child of POST 2.1)
     * POST 3
     * ```
     *
     * If we request a thread for POST 1 we should get back:
     *
     * ```text
     * POST 1 (requested post)
     * POST 1.1 (immediate child)
     * POST 1.2 (immediate child)
     * ```
     *
     * If we request a thread for post 1.2.2 we should get back:
     *
     * ```text
     * POST 1 (root ancestor)
     * POST 1.2 (immediate parent)
     * POST 1.2.2 (requested post)
     * POST 1.2.2.1 (immediate child)
     * ```
     *
     * If we request a thread for post 2.1.1 we should get back:
     *
     * ```text
     * POST 2 (root ancestor)
     * POST 2.1 (immediate parent)
     * POST 2.1.1 (requested post)
     * ```
     *
     * @param apId AP ID of the post to get the thread for
     * @param accountId ID of the account to resolve post metadata for (i.e is
     * a post in the thread liked by the account, or reposted by the account, etc)
     */
    async getThreadByApId(
        apId: string,
        accountId: number,
    ): Promise<ThreadPosts> {
        // Get the post for the given AP ID
        const post = await this.db('posts')
            .select('id', 'in_reply_to')
            .where('ap_id', apId)
            .first();

        if (!post) {
            return [];
        }

        const postIdsForThread = [];

        // Recursively find the parent posts of the resolved post
        // and add them to the thread in reverse order so that we can
        // eventually return the thread in the correct order
        let nextParentId = post.in_reply_to;

        while (nextParentId) {
            const parent = await this.db('posts')
                .select('in_reply_to')
                .where('id', nextParentId)
                .first();

            if (parent) {
                postIdsForThread.unshift(nextParentId);
            }

            nextParentId = parent.in_reply_to;
        }

        // Add the resolved post to the thread after all the parent posts
        postIdsForThread.push(post.id);

        // Find all the posts that are immediate children of the resolved post
        // and have not been deleted
        for (const row of await this.db('posts')
            .select('id')
            .where('in_reply_to', post.id)
            .andWhere('deleted_at', null)) {
            postIdsForThread.push(row.id);
        }

        // Get all the posts that are in the thread
        const thread = await this.db('posts')
            .select(
                // Post fields
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
                'posts.attachments',
                'posts.author_id',
                'posts.ap_id',
                'posts.in_reply_to',
                'posts.thread_root',
                'posts.deleted_at',
                // Author account fields
                'accounts.username',
                'accounts.uuid as author_uuid',
                'accounts.name',
                'accounts.bio',
                'accounts.avatar_url',
                'accounts.banner_image_url',
                'accounts.ap_id as author_ap_id',
                'accounts.url as author_url',
                'accounts.ap_followers_url as author_ap_followers_url',
                // Account metadata fields
                this.db.raw(`
                    CASE
                        WHEN likes.account_id IS NOT NULL THEN 1
                        ELSE 0
                    END AS liked_by_account
                `),
                this.db.raw(`
                    CASE
                        WHEN reposts.account_id IS NOT NULL THEN 1
                        ELSE 0
                    END AS reposted_by_account
                `),
            )
            .join('accounts', 'accounts.id', 'posts.author_id')
            .leftJoin('users', 'users.account_id', 'accounts.id')
            .leftJoin('sites', 'sites.id', 'users.site_id')
            .leftJoin('likes', function () {
                this.on('likes.post_id', 'posts.id').andOnVal(
                    'likes.account_id',
                    '=',
                    accountId,
                );
            })
            .leftJoin('reposts', function () {
                this.on('reposts.post_id', 'posts.id').andOnVal(
                    'reposts.account_id',
                    '=',
                    accountId,
                );
            })
            .whereIn('posts.id', postIdsForThread)
            .orderBy('posts.published_at', 'asc');

        const posts = [];

        for (const row of thread) {
            if (!row.author_uuid) {
                row.author_uuid = randomUUID();
                await this.db('accounts')
                    .update({ uuid: row.author_uuid })
                    .where({ id: row.author_id });
            }

            let site: AccountSite | null = null;

            if (
                typeof row.site_id === 'number' &&
                typeof row.site_host === 'string'
            ) {
                site = {
                    id: row.site_id,
                    host: row.site_host,
                };
            }

            const author = new Account(
                row.author_id,
                row.author_uuid,
                row.username,
                row.name,
                row.bio,
                parseURL(row.avatar_url),
                parseURL(row.banner_image_url),
                site,
                parseURL(row.author_ap_id),
                parseURL(row.author_url),
                parseURL(row.author_ap_followers_url),
            );

            const attachments = row.attachments
                ? row.attachments.map((attachment: any) => ({
                      ...attachment,
                      url: new URL(attachment.url),
                  }))
                : [];

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
                attachments,
                new URL(row.ap_id),
                row.deleted_at !== null,
            );

            posts.push({
                post,
                likedByAccount: row.liked_by_account === 1,
                repostedByAccount: row.reposted_by_account === 1,
            });
        }

        return posts;
    }

    /**
     * Save a post to the database
     *
     * @param post Post to save
     */
    async save(post: Post): Promise<void> {
        const isNewPost = post.isNew;
        const isDeletedPost = Post.isDeleted(post);

        if (post.author.id === null) {
            throw new Error(
                `Unable to save Post ${post.uuid} - The author is missing an id.`,
            );
        }

        if (isNewPost && isDeletedPost) {
            return;
        }

        const transaction = await this.db.transaction();

        try {
            const { likesToAdd, likesToRemove } = post.getChangedLikes();
            const { repostsToAdd, repostsToRemove } = post.getChangedReposts();
            let repostAccountIds: number[] = [];
            let wasDeleted = false;

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
            } else if (isDeletedPost) {
                const existingRow = await transaction('posts')
                    .select('deleted_at')
                    .where({
                        id: post.id,
                    })
                    .first();

                if (existingRow && existingRow.deleted_at === null) {
                    await transaction('posts')
                        .update({
                            deleted_at: transaction.raw('CURRENT_TIMESTAMP'),
                        })
                        .where({ id: post.id });

                    if (post.inReplyTo) {
                        await transaction('posts')
                            .update({
                                reply_count: this.db.raw('reply_count - 1'),
                            })
                            .where({ id: post.inReplyTo });
                    }

                    // Delete likes associated with the deleted post
                    await transaction('likes')
                        .where({ post_id: post.id })
                        .del();

                    wasDeleted = true;
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
                await this.events.emitAsync(
                    PostCreatedEvent.getName(),
                    new PostCreatedEvent(post),
                );
            }

            if (wasDeleted) {
                await this.events.emitAsync(
                    PostDeletedEvent.getName(),
                    new PostDeletedEvent(post, post.author.id),
                );
            }

            for (const accountId of repostAccountIds) {
                await this.events.emitAsync(
                    PostRepostedEvent.getName(),
                    new PostRepostedEvent(post, accountId),
                );
            }

            for (const accountId of repostsToRemove) {
                await this.events.emitAsync(
                    PostDerepostedEvent.getName(),
                    new PostDerepostedEvent(post, accountId),
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
            attachments:
                post.attachments && post.attachments.length > 0
                    ? JSON.stringify(post.attachments)
                    : null,
            reading_time_minutes: post.readingTimeMinutes,
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
