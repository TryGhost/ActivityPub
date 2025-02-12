import type EventEmitter from 'node:events';
import type { Knex } from 'knex';
import type { Post } from './post.entity';

export class KnexPostRepository {
    constructor(
        private readonly db: Knex,
        private readonly events: EventEmitter,
    ) {}

    async save(post: Post): Promise<void> {
        if (post.isNew) {
            const [id] = await this.db('posts').insert({
                uuid: post.uuid,
                type: post.type,
                audience: post.audience,
                author_id: post.author.id,
                title: post.title,
                excerpt: post.excerpt,
                content: post.content,
                url: post.url.href,
                image_url: post.imageUrl?.href,
                published_at: post.publishedAt,
                in_reply_to: post.inReplyTo?.id,
                thread_root: post.threadRoot?.id,
                like_count: 0,
                repost_count: 0,
                reply_count: 0,
                reading_time_minutes: post.readingTime,
                ap_id: post.apId.href,
            });
            // Hacks? Mutate the Post so `isNew` returns false.
            (post as any).id = id;
        } else {
            // Handle updates
        }
    }
}
