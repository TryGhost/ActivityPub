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

interface PostData {
    type: PostType;
    audience?: Audience;
    title?: string | null;
    excerpt?: string | null;
    content: string | null;
    url?: URL | null;
    imageUrl?: URL | null;
    publishedAt?: Date;
    inReplyTo?: Post;
}

export type PublicPost = Post & {
    audience: Audience.Public;
};

export type FollowersOnlyPost = Post & {
    audience: Audience.FollowersOnly;
};

export function isPublicPost(post: Post): post is PublicPost {
    return post.audience === Audience.Public;
}

export function isFollowersOnlyPost(post: Post): post is FollowersOnlyPost {
    return post.audience === Audience.FollowersOnly;
}

export class Post extends BaseEntity {
    public readonly uuid: string;
    public readonly apId: URL;
    private potentiallyNewLikes: Set<number> = new Set();

    constructor(
        public readonly id: number | null,
        uuid: string | null,
        public readonly author: Account,
        public readonly type: PostType,
        public readonly audience: Audience,
        public readonly title: string | null,
        public readonly excerpt: string | null,
        public readonly content: string | null,
        public readonly url: URL | null,
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
        if (url === null) {
            this.url = this.apId;
        } else {
            this.url = url;
        }
    }

    get readingTime() {
        // TODO Implement reading time calculation
        return this.readingTimeMinutes || 1;
    }

    addLike(account: Account) {
        if (!account.id) {
            throw new Error('Cannot add like for account with no id');
        }
        this.potentiallyNewLikes.add(account.id);
    }

    getPotentiallyNewLikes() {
        const likes = [...this.potentiallyNewLikes.values()];
        this.potentiallyNewLikes.clear();
        return likes;
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

    static createFromData(account: Account, data: PostData): Post {
        return new Post(
            null,
            null,
            account,
            data.type,
            data.audience ?? Audience.Public,
            data.title ?? null,
            data.excerpt ?? null,
            data.content,
            data.url ?? null,
            data.imageUrl ?? null,
            data.publishedAt ?? new Date(),
            0,
            0,
            0,
            data.inReplyTo ?? null,
        );
    }
}
