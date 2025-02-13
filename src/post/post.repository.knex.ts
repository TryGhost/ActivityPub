import type EventEmitter from 'node:events';
import type { Knex } from 'knex';
import { Account } from '../account/account.entity';
import { parseURL } from '../core/url';
import { Post } from './post.entity';

export class KnexPostRepository {
    constructor(
        private readonly db: Knex,
        private readonly events: EventEmitter,
    ) {}

    async getByApId(apId: URL): Promise<Post | null> {
        const row = await this.db('posts')
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

            if (post.isNew) {
                const [id] = await transaction('posts').insert({
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
                    like_count: potentiallyNewLikes.length,
                    repost_count: 0,
                    reply_count: 0,
                    reading_time_minutes: post.readingTime,
                    ap_id: post.apId.href,
                });

                if (potentiallyNewLikes.length > 0) {
                    const likesToInsert = potentiallyNewLikes.map(
                        (accountId) => ({
                            account_id: accountId,
                            post_id: id,
                        }),
                    );

                    await transaction('likes').insert(likesToInsert);
                }
                // Hacks? Mutate the Post so `isNew` returns false.
                (post as any).id = id;
            } else {
                if (potentiallyNewLikes.length > 0) {
                    const likesToInsert = potentiallyNewLikes.map(
                        (accountId) => ({
                            account_id: accountId,
                            post_id: post.id,
                        }),
                    );

                    await transaction('likes')
                        .insert(likesToInsert)
                        .onConflict()
                        .ignore();

                    const [[{ insertedRows }]] = await transaction.raw(
                        'SELECT ROW_COUNT() as insertedRows',
                    );

                    await transaction('posts')
                        .update({
                            like_count: this.db.raw(
                                `like_count + ${insertedRows}`,
                            ),
                        })
                        .where({ id: post.id });

                    // TODO Potentially want to update the post entity here?
                }
            }

            await transaction.commit();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    }
}
