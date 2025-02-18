import type EventEmitter from 'node:events';
import type { Knex } from 'knex';

import { Account } from '../account/account.entity';
import { TABLE_LIKES, TABLE_POSTS, TABLE_REPOSTS } from '../constants';
import { parseURL } from '../core/url';
import { PostCreatedEvent } from './post-created.event';
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
                'accounts.username',
                'accounts.name',
                'accounts.bio',
                'accounts.avatar_url',
                'accounts.banner_image_url',
            )
            .first();

        if (!row) {
            return null;
        }

        const author = new Account(
            row.author_id,
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
            null,
            null,
            row.reading_time_minutes,
            new URL(row.ap_id),
        );

        return post;
    }

    async save(post: Post): Promise<void> {
        const transaction = await this.db.transaction();

        try {
            const potentiallyNewLikes = post.getPotentiallyNewLikes();
            const potentiallyNewReposts = post.getPotentiallyNewReposts();

            if (post.isNew) {
                const postId = await this.insertPost(
                    post,
                    potentiallyNewLikes.length,
                    potentiallyNewReposts.length,
                    transaction,
                );

                // Hacks? Mutate the Post so `isNew` returns false.
                (post as any).id = postId;

                if (potentiallyNewLikes.length > 0) {
                    await this.insertLikes(
                        post,
                        potentiallyNewLikes,
                        transaction,
                    );
                }

                if (potentiallyNewReposts.length > 0) {
                    await this.insertReposts(
                        post,
                        potentiallyNewReposts,
                        transaction,
                    );
                }
            } else {
                let insertedLikeCount = 0;
                let insertedRepostCount = 0;

                if (potentiallyNewLikes.length > 0) {
                    insertedLikeCount =
                        await this.insertLikesIgnoringDuplicates(
                            post,
                            potentiallyNewLikes,
                            transaction,
                        );
                }

                if (potentiallyNewReposts.length > 0) {
                    insertedRepostCount =
                        await this.insertRepostsIgnoringDuplicates(
                            post,
                            potentiallyNewReposts,
                            transaction,
                        );
                }

                if (insertedLikeCount > 0 || insertedRepostCount > 0) {
                    await this.updatePost(
                        post,
                        insertedLikeCount,
                        insertedRepostCount,
                        transaction,
                    );
                }
            }

            await transaction.commit();

            this.events.emit(
                PostCreatedEvent.getName(),
                new PostCreatedEvent(post),
            );
        } catch (err) {
            await transaction.rollback();

            throw err;
        }
    }

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
            in_reply_to: post.inReplyTo?.id,
            thread_root: post.threadRoot?.id,
            like_count: likeCount,
            repost_count: repostCount,
            reply_count: 0,
            reading_time_minutes: post.readingTime,
            ap_id: post.apId.href,
        });

        return id;
    }

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

        return count || 0;
    }

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

    private async insertRepostsIgnoringDuplicates(
        post: Post,
        repostAccountIds: number[],
        transaction: Knex.Transaction,
    ): Promise<number> {
        const repostsToInsert = repostAccountIds.map((accountId) => ({
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

        return count || 0;
    }

    private async updatePost(
        post: Post,
        likeCount: number,
        repostCount: number,
        transaction: Knex.Transaction,
    ) {
        await transaction(TABLE_POSTS)
            .update({
                like_count: this.db.raw(`like_count + ${likeCount}`),
                repost_count: this.db.raw(`repost_count + ${repostCount}`),
            })
            .where({ id: post.id });
    }
}
