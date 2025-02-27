import { randomUUID } from 'node:crypto';
import { ContentPreparer } from 'publishing/content';
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
    uuid: string;
    html: string | null;
    excerpt: string | null;
    feature_image: string | null;
    published_at: string;
    url: string;
    visibility: string;
}

export interface PostAttachment {
    type: string | null;
    mediaType: string | null;
    name: string | null;
    url: URL;
}

export interface PostData {
    type: PostType;
    audience?: Audience;
    title?: string | null;
    excerpt?: string | null;
    content?: string | null;
    url?: URL | null;
    imageUrl?: URL | null;
    publishedAt?: Date;
    inReplyTo?: Post | null;
    apId?: URL | null;
    attachments?: PostAttachment[] | null;
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
    public readonly url: URL;
    private likesToRemove: Set<number> = new Set();
    private likesToAdd: Set<number> = new Set();
    private repostsToAdd: Set<number> = new Set();
    private repostsToRemove: Set<number> = new Set();

    constructor(
        public readonly id: number | null,
        uuid: string | null,
        public readonly author: Account,
        public readonly type: PostType,
        public readonly audience: Audience,
        public readonly title: string | null,
        public readonly excerpt: string | null,
        public readonly content: string | null,
        url: URL | null,
        public readonly imageUrl: URL | null,
        public readonly publishedAt: Date,
        public readonly likeCount = 0,
        public readonly repostCount = 0,
        public readonly replyCount = 0,
        public readonly inReplyTo: number | null = null,
        public readonly threadRoot: number | null = null,
        private readonly _readingTimeMinutes: number | null = null,
        public readonly attachments: PostAttachment[] = [],
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

    get readingTimeMinutes() {
        // TODO Implement reading time calculation
        return this._readingTimeMinutes || 1;
    }

    addLike(account: Account) {
        if (!account.id) {
            throw new Error('Cannot add like for account with no id');
        }
        this.likesToRemove.delete(account.id);
        this.likesToAdd.add(account.id);
    }

    removeLike(account: Account) {
        if (!account.id) {
            throw new Error('Cannot remove like for account with no id');
        }
        this.likesToAdd.delete(account.id);
        this.likesToRemove.add(account.id);
    }

    getChangedLikes() {
        const likesToRemove = [...this.likesToRemove.values()];
        this.likesToRemove.clear();
        const likesToAdd = [...this.likesToAdd.values()];
        this.likesToAdd.clear();
        return {
            likesToRemove,
            likesToAdd,
        };
    }

    addRepost(account: Account) {
        if (!account.id) {
            throw new Error('Cannot add repost for account with no id');
        }
        this.repostsToRemove.delete(account.id);
        this.repostsToAdd.add(account.id);
    }

    removeRepost(account: Account) {
        if (!account.id) {
            throw new Error('Cannot remove repost for account with no id');
        }
        this.repostsToAdd.delete(account.id);
        this.repostsToRemove.add(account.id);
    }

    getChangedReposts() {
        const repostsToRemove = [...this.repostsToRemove.values()];
        this.repostsToRemove.clear();
        const repostsToAdd = [...this.repostsToAdd.values()];
        this.repostsToAdd.clear();
        return {
            repostsToRemove,
            repostsToAdd,
        };
    }

    static createArticleFromGhostPost(
        account: Account,
        ghostPost: GhostPost,
    ): Post {
        const isPublic = ghostPost.visibility === 'public';

        let content = ghostPost.html;
        if (isPublic === false && ghostPost.html !== null) {
            content = ContentPreparer.prepare(ghostPost.html, {
                removeMemberContent: true,
            });

            if (content === ghostPost.html) {
                content = '';
            }
        }

        if (isPublic === false && content === '') {
            throw new Error('Cannot create Post from private content');
        }

        return new Post(
            null,
            ghostPost.uuid,
            account,
            PostType.Article,
            Audience.Public,
            ghostPost.title,
            ghostPost.excerpt,
            content,
            new URL(ghostPost.url),
            parseURL(ghostPost.feature_image),
            new Date(ghostPost.published_at),
        );
    }

    static createFromData(account: Account, data: PostData): Post {
        let inReplyTo = null;
        let threadRoot = null;

        if (data.inReplyTo) {
            if (!data.inReplyTo.id) {
                throw new Error('Cannot reply to a Post without an id');
            }

            inReplyTo = data.inReplyTo.id;
            threadRoot = data.inReplyTo.threadRoot ?? data.inReplyTo.id;
        }

        return new Post(
            null,
            null,
            account,
            data.type,
            data.audience ?? Audience.Public,
            data.title ?? null,
            data.excerpt ?? null,
            data.content ?? null,
            data.url ?? null,
            data.imageUrl ?? null,
            data.publishedAt ?? new Date(),
            0,
            0,
            0,
            inReplyTo,
            threadRoot,
            null,
            data.attachments ?? [],
            data.apId ?? null,
        );
    }
}
