import type EventEmitter from 'node:events';
import type { Knex } from 'knex';
import type { Post } from './post.entity';

export class KnexPostRepository {
    constructor(
        private readonly db: Knex,
        private readonly events: EventEmitter,
    ) {}

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
