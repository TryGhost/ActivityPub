import { randomUUID } from 'node:crypto';
import type { Account } from '../account/account.entity';
import { BaseEntity } from '../core/base.entity';
import { parseURL } from '../core/url';

export enum PostType {
    Note = 0,
    Article = 1,
}

export enum Audience {
    Public = 0,
    FollowersOnly = 1,
    Direct = 2,
}

// TODO Deduplicate this with the webhook handler
interface GhostPost {
    title: string;
    html: string | null;
    excerpt: string | null;
    feature_image: string | null;
    published_at: string;
    url: string;
}

export class Post extends BaseEntity {
    public readonly uuid: string;
    public readonly apId: URL;

    constructor(
        public readonly id: number | null,
        uuid: string | null,
        public readonly author: Account,
        public readonly type: PostType,
        public readonly audience: Audience,
        public readonly title: string | null,
        public readonly excerpt: string | null,
        public readonly content: string | null,
        public readonly url: URL,
        public readonly imageUrl: URL | null,
        public readonly publishedAt: Date,
        private likeCount = 0,
        private repostCount = 0,
        private replyCount = 0,
        public readonly inReplyTo: Post | null = null,
        public readonly threadRoot: Post | null = null,
        private readonly readingTimeMinutes: number | null = null,
        apId: URL | null = null,
    ) {
        super(id);
        if (uuid === null) {
            this.uuid = randomUUID();
        } else {
            this.uuid = uuid;
        }
        if (apId === null) {
            this.apId = author.getApIdForPost(this);
        } else {
            this.apId = apId;
        }
    }

    get readingTime() {
        // TODO Implement reading time calculation
        return this.readingTimeMinutes || 1;
    }

    static createArticleFromGhostPost(
        account: Account,
        ghostPost: GhostPost,
    ): Post {
        return new Post(
            null,
            null,
            account,
            PostType.Article,
            Audience.Public,
            ghostPost.title,
            ghostPost.excerpt,
            ghostPost.html,
            new URL(ghostPost.url),
            parseURL(ghostPost.feature_image),
            new Date(ghostPost.published_at),
        );
    }
}
