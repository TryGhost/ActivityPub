import type { Knex } from 'knex';

import { randomUUID } from 'node:crypto';
import type { AsyncEvents } from 'core/events';
import { AccountEntity } from '../account/account.entity';
import { parseURL } from '../core/url';
import { PostCreatedEvent } from './post-created.event';
import { PostDeletedEvent } from './post-deleted.event';
import { PostDerepostedEvent } from './post-dereposted.event';
import { PostLikedEvent } from './post-liked.event';
import { PostRepostedEvent } from './post-reposted.event';
import {
    type Audience,
    type CreatePostType,
    type MentionedAccount,
    type Metadata,
    OutboxType,
    Post,
} from './post.entity';

interface PostRow {
    id: number;
    uuid: string | null;
    type: CreatePostType;
    audience: Audience;
    title: string | null;
    excerpt: string | null;
    summary: string | null;
    content: string | null;
    url: string;
    image_url: string | null;
    published_at: Date;
    like_count: number;
    repost_count: number;
    liked_by_current_user: 0 | 1;
    reply_count: number;
    reposted_by_current_user: 0 | 1;
    reading_time_minutes: number;
    attachments: {
        type: string | null;
        mediaType: string | null;
        name: string | null;
        url: string;
    }[];
    author_id: number;
    ap_id: string;
    in_reply_to: number | null;
    thread_root: number | null;
    deleted_at: string | null;
    metadata: Metadata;
    updated_at: string | null;
    username: string;
    author_uuid: string | null;
    name: string | null;
    bio: string | null;
    avatar_url: string | null;
    banner_image_url: string | null;
    author_ap_id: string;
    author_url: string | null;
    author_ap_followers_url: string | null;
    author_ap_inbox_url: string | null;
    site_id: number | null;
    site_host: string | null;
}

export interface Outbox {
    items: {
        post: Post;
        type: OutboxType;
    }[];
    nextCursor: string | null;
}

export class KnexPostRepository {
    constructor(
        private readonly db: Knex,
        private readonly events: AsyncEvents,
    ) {}

    private async getByQuery(query: Knex.QueryCallback): Promise<Post | null> {
        const row = await this.db('posts')
            .join('accounts', 'accounts.id', 'posts.author_id')
            .leftJoin('users', 'users.account_id', 'accounts.id')
            .leftJoin('sites', 'sites.id', 'users.site_id')
            .where(query)
            .select(
                'posts.id',
                'posts.uuid',
                'posts.type',
                'posts.audience',
                'posts.title',
                'posts.excerpt',
                'posts.summary',
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
                'posts.metadata',
                'posts.updated_at',
                'accounts.id as author_id',
                'accounts.username',
                'accounts.uuid as author_uuid',
                'accounts.name',
                'accounts.bio',
                'accounts.avatar_url',
                'accounts.banner_image_url',
                'accounts.ap_id as author_ap_id',
                'accounts.url as author_url',
                'accounts.ap_followers_url as author_ap_followers_url',
                'accounts.ap_inbox_url as author_ap_inbox_url',
                'sites.id as site_id',
                'sites.host as site_host',
            )
            .first();

        if (!row) {
            return null;
        }

        return this.mapRowToPostEntity(row);
    }

    private async getPostMentions(postId: number): Promise<MentionedAccount[]> {
        const mentions = await this.db('mentions')
            .join('accounts', 'accounts.id', 'mentions.account_id')
            .where('mentions.post_id', postId)
            .select('accounts.id', 'accounts.ap_id', 'accounts.username');
        return mentions.map((mention) => ({
            id: mention.id,
            apId: new URL(mention.ap_id),
            username: mention.username,
        }));
    }

    async getById(id: Post['id']): Promise<Post | null> {
        return await this.getByQuery((qb: Knex.QueryBuilder) => {
            return qb.where('posts.id', id);
        });
    }

    async getByApId(apId: URL): Promise<Post | null> {
        return await this.getByQuery((qb: Knex.QueryBuilder) => {
            return qb.whereRaw('posts.ap_id_hash = UNHEX(SHA2(?, 256))', [
                apId.href,
            ]);
        });
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
            const mentionsToAdd = post.mentions;
            let likeAccountIds: number[] = [];
            let repostAccountIds: number[] = [];
            let wasDeleted = false;
            let outboxType: OutboxType = OutboxType.Original;

            if (isNewPost) {
                const { id, isDuplicate } = await this.insertPost(
                    post,
                    likesToAdd.length,
                    repostsToAdd.length,
                    transaction,
                );

                // Hacks? Mutate the Post so `isNew` returns false.
                // TODO: Clean up the any type
                // biome-ignore lint/suspicious/noExplicitAny: Legacy code needs proper typing
                (post as any).id = id;

                if (isDuplicate) {
                    await transaction.rollback();

                    return;
                }

                if (post.inReplyTo) {
                    await transaction('posts')
                        .update({
                            reply_count: this.db.raw('reply_count + 1'),
                        })
                        .where({ id: post.inReplyTo });
                    outboxType = OutboxType.Reply;
                }

                // Add outbox entry for original post or reply
                await this.insertOutboxItems(
                    post,
                    outboxType,
                    [post.author.id],
                    transaction,
                );

                if (likesToAdd.length > 0) {
                    await this.insertLikes(post, likesToAdd, transaction);

                    likeAccountIds = likesToAdd.map((accountId) => accountId);
                }

                if (repostsToAdd.length > 0) {
                    await this.insertReposts(post, repostsToAdd, transaction);

                    repostAccountIds = repostsToAdd.map(
                        (accountId) => accountId,
                    );

                    // Add outbox entries for reposts
                    await this.insertOutboxItems(
                        post,
                        OutboxType.Repost,
                        repostAccountIds,
                        transaction,
                    );
                }

                if (mentionsToAdd.length > 0) {
                    await this.insertMentions(post, mentionsToAdd, transaction);
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

                    // Delete mentions associated with the deleted post
                    await transaction('mentions')
                        .where({ post_id: post.id })
                        .del();

                    // Delete outboxes associated with the deleted post
                    await transaction('outboxes')
                        .where({ post_id: post.id })
                        .del();

                    wasDeleted = true;
                }
            } else {
                if (likesToAdd.length > 0 || likesToRemove.length > 0) {
                    const { insertedLikesCount, accountIdsInserted } =
                        likesToAdd.length > 0
                            ? await this.insertLikesIgnoringDuplicates(
                                  post,
                                  likesToAdd,
                                  transaction,
                              )
                            : {
                                  insertedLikesCount: 0,
                                  accountIdsInserted: [],
                              };

                    const removedLikesCount =
                        likesToRemove.length > 0
                            ? await this.removeLikes(
                                  post,
                                  likesToRemove,
                                  transaction,
                              )
                            : 0;

                    likeAccountIds = accountIdsInserted.filter(
                        (accountId) => !likesToRemove.includes(accountId),
                    );

                    if (insertedLikesCount - removedLikesCount !== 0) {
                        await transaction('posts')
                            .update({
                                like_count: post.isInternal
                                    ? transaction.raw(
                                          `like_count + ${insertedLikesCount - removedLikesCount}`,
                                      )
                                    : // If the post is external, we need to
                                      // account for any changes that were
                                      // made to the post's like count
                                      // manually
                                      post.likeCount +
                                      (insertedLikesCount - removedLikesCount),
                            })
                            .where({ id: post.id });
                    }
                } else {
                    // If no likes were added or removed, and the post is
                    // external, update the like count in the database to
                    // account for manual changes to the post's like count
                    if (!post.isInternal) {
                        await transaction('posts')
                            .update({
                                like_count: post.likeCount,
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
                        await transaction('posts')
                            .update({
                                repost_count: post.isInternal
                                    ? transaction.raw(
                                          `repost_count + ${insertedRepostsCount - removedRepostsCount}`,
                                      )
                                    : // If the post is external, we need to
                                      // account for any changes that were
                                      // made to the post's repost count manually
                                      post.repostCount +
                                      insertedRepostsCount -
                                      removedRepostsCount,
                            })
                            .where({ id: post.id });
                    }

                    if (repostsToRemove.length > 0) {
                        await this.removeOutboxItems(
                            post,
                            OutboxType.Repost,
                            repostsToRemove,
                            transaction,
                        );
                    }

                    if (repostsToAdd.length > 0) {
                        await this.insertOutboxItems(
                            post,
                            OutboxType.Repost,
                            repostAccountIds,
                            transaction,
                        );
                    }
                } else {
                    // If no reposts were added or removed, and the post is
                    // external, update the repost count in the database to
                    // account for manual changes to the post's repost count
                    if (!post.isInternal) {
                        await transaction('posts')
                            .update({
                                repost_count: post.repostCount,
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

            for (const accountId of likeAccountIds) {
                await this.events.emitAsync(
                    PostLikedEvent.getName(),
                    new PostLikedEvent(post, accountId),
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
     * @returns ID of the inserted post and a boolean indicating if the post
     * was a duplicate
     */
    private async insertPost(
        post: Post,
        likeCount: number,
        repostCount: number,
        transaction: Knex.Transaction,
    ) {
        try {
            const [id] = await transaction('posts').insert({
                uuid: post.uuid,
                type: post.type,
                audience: post.audience,
                author_id: post.author.id,
                title: post.title,
                excerpt: post.excerpt,
                summary: post.summary,
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
                metadata: post.metadata,
            });

            return {
                id,
                isDuplicate: false,
            };
        } catch (err) {
            // This can occur when there is concurrency in the system and
            // multiple requests try to save a post with the same apId at
            // the same time
            if (
                err instanceof Error &&
                'code' in err &&
                err.code === 'ER_DUP_ENTRY' &&
                err.message.includes('ap_id_hash')
            ) {
                const row = await transaction('posts')
                    .whereRaw('ap_id_hash = UNHEX(SHA2(?, 256))', [
                        post.apId.href,
                    ])
                    .select('id')
                    .first();

                if (row) {
                    return {
                        id: row.id,
                        isDuplicate: true,
                    };
                }
            }

            throw err;
        }
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

        await transaction('likes').insert(likesToInsert);
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
        return await transaction('likes')
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
     * @returns Number of likes inserted and the account IDs of the
     * likes that were inserted
     */
    private async insertLikesIgnoringDuplicates(
        post: Post,
        likeAccountIds: number[],
        transaction: Knex.Transaction,
    ): Promise<{ insertedLikesCount: number; accountIdsInserted: number[] }> {
        // Retrieve the account IDs of the likes that are already in the
        // database - This is so we can report exactly which likes were
        // inserted so that we do not emit events for likes that were
        // already in the database
        const currentLikeAccountIds = (
            await transaction('likes')
                .where('post_id', post.id)
                .select('account_id')
        ).map((row) => row.account_id);

        const newLikeAccountIds = likeAccountIds.filter(
            (accountId) => !currentLikeAccountIds.includes(accountId),
        );

        if (newLikeAccountIds.length === 0) {
            return {
                insertedLikesCount: 0,
                accountIdsInserted: [],
            };
        }

        const likesToInsert = newLikeAccountIds.map((accountId) => ({
            account_id: accountId,
            post_id: post.id,
        }));

        await transaction('likes').insert(likesToInsert).onConflict().ignore();

        const [[{ count }]] = await transaction.raw(
            'SELECT ROW_COUNT() as count',
        );

        return {
            insertedLikesCount: count,
            accountIdsInserted: newLikeAccountIds,
        };
    }

    private async insertOutboxItems(
        post: Post,
        outboxType: OutboxType,
        outboxAccountIds: number[],
        transaction: Knex.Transaction,
    ) {
        try {
            // We want to insert outbox items for internal accounts only
            const internalAccountIds = await transaction('users')
                .whereIn('account_id', outboxAccountIds)
                .select('account_id');

            if (internalAccountIds.length === 0) {
                return;
            }

            const outboxItemsToInsert = internalAccountIds.map(
                ({ account_id }) => ({
                    account_id: account_id,
                    post_id: post.id,
                    post_type: post.type,
                    outbox_type: outboxType,
                    published_at:
                        outboxType === OutboxType.Repost
                            ? new Date()
                            : post.publishedAt,
                    author_id: post.author.id,
                }),
            );

            await transaction('outboxes').insert(outboxItemsToInsert);
        } catch (err) {
            // If the item is already in the outbox, we can ignore it
            if (
                err instanceof Error &&
                'code' in err &&
                err.code === 'ER_DUP_ENTRY'
            ) {
                return;
            }

            throw err;
        }
    }

    private async removeOutboxItems(
        post: Post,
        outboxType: OutboxType,
        outboxAccountIds: number[],
        transaction: Knex.Transaction,
    ) {
        await transaction('outboxes')
            .where({
                post_id: post.id,
                outbox_type: outboxType,
            })
            .whereIn('account_id', outboxAccountIds)
            .del();
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

        await transaction('reposts').insert(repostsToInsert);
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
        return await transaction('reposts')
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
            await transaction('reposts')
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

        await transaction('reposts')
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

    /**
     * Insert mentions of a post into the database
     *
     * @param post Post to insert mentions for
     * @param mentionedAccounts Mentioned accounts to insert
     * @param transaction Database transaction to use
     */
    private async insertMentions(
        post: Post,
        mentionedAccounts: MentionedAccount[],
        transaction: Knex.Transaction,
    ) {
        const mentionsToInsert = mentionedAccounts.map((mentionedAccount) => ({
            account_id: mentionedAccount.id,
            post_id: post.id,
        }));

        await transaction('mentions').insert(mentionsToInsert);
    }

    /**
     * Check if a post is liked by an account
     *
     * @param postId ID of the post to check
     * @param accountId ID of the account to check
     * @returns True if the post is liked by the account, false otherwise
     */
    async isLikedByAccount(postId: number, accountId: number) {
        const result = await this.db('likes')
            .where({
                post_id: postId,
                account_id: accountId,
            })
            .first();

        return result !== undefined;
    }

    /**
     * Check if a post is reposted by an account
     *
     * @param postId ID of the post to check
     * @param accountId ID of the account to check
     * @returns True if the post is reposted by the account, false otherwise
     */
    async isRepostedByAccount(postId: number, accountId: number) {
        const result = await this.db('reposts')
            .where({
                post_id: postId,
                account_id: accountId,
            })
            .first();

        return result !== undefined;
    }

    private async mapRowToPostEntity(row: PostRow): Promise<Post> {
        if (!row.author_uuid) {
            row.author_uuid = randomUUID();
            await this.db('accounts')
                .update({ uuid: row.author_uuid })
                .where({ id: row.author_id });
        }

        const author = AccountEntity.create({
            id: row.author_id,
            uuid: row.author_uuid,
            username: row.username,
            name: row.name,
            bio: row.bio,
            url: parseURL(row.author_url) || new URL(row.author_ap_id),
            avatarUrl: parseURL(row.avatar_url),
            bannerImageUrl: parseURL(row.banner_image_url),
            apId: new URL(row.author_ap_id),
            apFollowers: parseURL(row.author_ap_followers_url),
            apInbox: parseURL(row.author_ap_inbox_url),
            isInternal: row.site_id !== null,
        });

        const attachments = row.attachments
            ? row.attachments.map(
                  (
                      // TODO: Clean up the any type
                      // biome-ignore lint/suspicious/noExplicitAny: Legacy code needs proper typing
                      attachment: any,
                  ) => ({
                      ...attachment,
                      url: new URL(attachment.url),
                  }),
              )
            : [];

        const post = new Post(
            row.id,
            row.uuid,
            author,
            row.type,
            row.audience,
            row.title,
            row.excerpt,
            row.summary,
            row.content,
            new URL(row.url),
            parseURL(row.image_url),
            new Date(row.published_at),
            row.metadata,
            row.like_count,
            row.repost_count,
            row.reply_count,
            row.in_reply_to,
            row.thread_root,
            row.reading_time_minutes,
            attachments,
            new URL(row.ap_id),
            row.deleted_at !== null,
            row.updated_at ? new Date(row.updated_at) : null,
        );

        if (post.id) {
            post.mentions.push(...(await this.getPostMentions(post.id)));
        }

        return post;
    }

    async getOutboxForAccount(
        accountId: number,
        cursor: string | null,
        pageSize: number,
    ): Promise<Outbox> {
        const rows = await this.db('outboxes')
            .select(
                'posts.id',
                'posts.uuid',
                'posts.type',
                'posts.audience',
                'posts.title',
                'posts.excerpt',
                'posts.summary',
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
                'posts.metadata',
                'posts.updated_at',
                'accounts.id as author_id',
                'accounts.username',
                'accounts.uuid as author_uuid',
                'accounts.name',
                'accounts.bio',
                'accounts.avatar_url',
                'accounts.banner_image_url',
                'accounts.ap_id as author_ap_id',
                'accounts.url as author_url',
                'accounts.ap_followers_url as author_ap_followers_url',
                'accounts.ap_inbox_url as author_ap_inbox_url',
                'sites.id as site_id',
                'sites.host as site_host',
                'outboxes.outbox_type',
            )
            .join('posts', 'outboxes.post_id', 'posts.id')
            .join('accounts', 'accounts.id', 'posts.author_id')
            .leftJoin('users', 'users.account_id', 'accounts.id')
            .leftJoin('sites', 'sites.id', 'users.site_id')
            .where('outboxes.account_id', accountId)
            .whereNot('outboxes.outbox_type', OutboxType.Reply) // Replies are not included in the outbox, only original posts and reposts
            .modify((query) => {
                if (cursor) {
                    query.where('outboxes.published_at', '<', cursor);
                }
            })
            .orderBy('outboxes.published_at', 'desc')
            .limit(pageSize + 1);

        const hasMore = rows.length > pageSize;
        const paginatedResults = rows.slice(0, pageSize);
        const lastResult = paginatedResults[paginatedResults.length - 1];
        const nextCursor =
            hasMore && lastResult
                ? lastResult.published_at.toISOString()
                : null;

        const outboxItems: {
            post: Post;
            type: OutboxType;
        }[] = [];
        for (const row of paginatedResults) {
            const post = await this.mapRowToPostEntity(row);
            outboxItems.push({
                post,
                type: row.outbox_type as OutboxType,
            });
        }

        return {
            items: outboxItems,
            nextCursor,
        };
    }

    async getOutboxItemCount(accountId: number): Promise<number> {
        const result = await this.db('outboxes')
            .where('account_id', accountId)
            .whereNot('outboxes.outbox_type', OutboxType.Reply) // Replies are not included in the outbox, only original posts and reposts
            .count('*', { as: 'count' });

        if (!result[0].count) {
            return 0;
        }

        return Number(result[0].count);
    }
}
