import { randomUUID } from 'node:crypto';

import z from 'zod';

import type { Account } from '@/account/account.entity';
import { BaseEntity } from '@/core/base.entity';
import { error, ok, type Result } from '@/core/result';
import { parseURL } from '@/core/url';
import { sanitizeHtml } from '@/helpers/html';
import { ContentPreparer, type PrepareContentOptions } from '@/post/content';

/** @see PostSummary.parse to get a branded PostSummary */
export type PostSummary = string & { readonly __brand: unique symbol };
export const PostSummary = z
    .string()
    .max(500)
    .transform((val) => val as PostSummary);

/** @see PostTitle.parse to get a branded PostTitle */
export type PostTitle = string & { readonly __brand: unique symbol };
export const PostTitle = z
    .string()
    .max(256)
    .transform((val) => val as PostTitle);

export enum PostType {
    Note = 0,
    Article = 1,
    Tombstone = 2,
}

export enum OutboxType {
    Original = 0,
    Repost = 1,
    Reply = 2,
}

export type CreatePostType = Exclude<PostType, PostType.Tombstone>;

export enum Audience {
    Public = 0,
    FollowersOnly = 1,
    Direct = 2,
}

type GhostAuthor = {
    name: string;
    profile_image: string | null;
};

export type Metadata = {
    ghostAuthors: GhostAuthor[];
} & Record<string, unknown>;

// TODO Deduplicate this with the webhook handler
export interface GhostPost {
    title: string;
    uuid: string;
    html: string | null;
    excerpt: string | null;
    custom_excerpt: string | null;
    feature_image: string | null;
    published_at: string;
    url: string;
    visibility: string;
    authors?: GhostAuthor[] | null;
}

export interface PostUpdateParams {
    title: PostTitle | null;
    content: string | null;
    excerpt: PostSummary | null;
    summary: PostSummary | null;
    imageUrl: URL | null;
    url: URL;
    metadata: Metadata | null;
}

export interface PostAttachment {
    type: string | null;
    mediaType: string | null;
    name: string | null;
    url: URL;
}

export interface Mention {
    name: string;
    href: URL;
    account: Account;
}

export interface ImageAttachment {
    url: URL;
    altText?: string;
}

export type MentionedAccount = Pick<Account, 'id' | 'apId' | 'username'>;

export interface PostData {
    type: CreatePostType;
    audience?: Audience;
    title?: string | null;
    excerpt?: string | null;
    summary?: string | null;
    content?: string | null;
    url?: URL | null;
    imageUrl?: URL | null;
    publishedAt?: Date;
    inReplyTo?: Post | null;
    apId?: URL | null;
    attachments?: PostAttachment[] | null;
    mentions?: Mention[] | null;
    metadata?: Metadata | null;
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

export type CreatePostError = 'private-content' | 'missing-content';

/**
 * TODO: Migrate to immutable entity pattern
 * @see ADR-0003: This should follow AccountEntity pattern
 *
 * Current issues:
 * - Mutable state with dirty flags
 * - Events created in repository, not entity
 * - Complex change tracking with Sets
 */
export class Post extends BaseEntity {
    public readonly uuid: string;
    public readonly apId: URL;
    private _url: URL;
    private likesToRemove: Set<number> = new Set();
    private likesToAdd: Set<number> = new Set();
    private repostsToAdd: Set<number> = new Set();
    private repostsToRemove: Set<number> = new Set();
    private deleted = false;
    private _likeCountDirty = false;
    private _repostCountDirty = false;
    private _updateDirty = false;
    private _content: string | null;
    private _title: PostTitle | null;
    private _excerpt: PostSummary | null;
    private _summary: PostSummary | null;
    private _imageUrl: URL | null;
    private _metadata: Metadata | null;
    public readonly mentions: MentionedAccount[] = [];

    constructor(
        public readonly id: number | null,
        uuid: string | null,
        public readonly author: Account,
        public readonly type: CreatePostType,
        public readonly audience: Audience,
        title: PostTitle | null,
        excerpt: PostSummary | null,
        summary: PostSummary | null,
        content: string | null,
        url: URL | null,
        imageUrl: URL | null,
        public readonly publishedAt: Date,
        metadata: Metadata | null = null,
        private _likeCount = 0,
        private _repostCount = 0,
        public readonly replyCount = 0,
        public readonly inReplyTo: number | null = null,
        public readonly threadRoot: number | null = null,
        private readonly _readingTimeMinutes: number | null = null,
        public readonly attachments: PostAttachment[] = [],
        apId: URL | null = null,
        _deleted = false,
        public readonly updatedAt: Date | null = null,
    ) {
        super(id);
        if (uuid === null) {
            this.uuid = randomUUID();
        } else {
            this.uuid = uuid;
        }
        if (apId === null) {
            this.apId = author.getApIdForPost({
                uuid: this.uuid,
                type,
            });
        } else {
            this.apId = apId;
        }
        if (url === null) {
            this._url = this.apId;
        } else {
            this._url = url;
        }
        this._title = title;
        this._excerpt = excerpt;
        this._summary = summary;
        this._content = content !== null ? sanitizeHtml(content) : null;
        this._imageUrl = imageUrl;
        this._metadata = metadata;
        if (_deleted) {
            this.deleted = true;
            this.handleDeleted();
        }
    }

    get title(): PostTitle | null {
        return this._title;
    }

    get excerpt(): PostSummary | null {
        return this._excerpt;
    }

    get summary(): PostSummary | null {
        return this._summary;
    }

    get content(): string | null {
        return this._content;
    }

    get imageUrl(): URL | null {
        return this._imageUrl;
    }

    get url(): URL {
        return this._url;
    }

    get metadata(): Metadata | null {
        return this._metadata;
    }

    get isInternal() {
        return this.author.isInternal;
    }

    delete(account: Account) {
        if (account.uuid !== this.author.uuid) {
            throw new Error(
                `Account ${account.uuid} cannot delete Post ${this.uuid}`,
            );
        }

        this.deleted = true;
        this.handleDeleted();
    }

    update(account: Account, params: PostUpdateParams) {
        if (account.uuid !== this.author.uuid) {
            throw new Error(
                `Account ${account.uuid} cannot update Post ${this.uuid}`,
            );
        }
        this._updateDirty = true;

        this._title = params.title;
        this._content = params.content ? sanitizeHtml(params.content) : null;
        this._excerpt = params.excerpt;
        this._summary = params.summary;
        this._imageUrl = params.imageUrl;
        this._url = params.url;
        this._metadata = params.metadata;
    }

    private handleDeleted() {
        // TODO: Clean up the any type
        // biome-ignore lint/suspicious/noExplicitAny: Legacy code needs proper typing
        const self = this as any;
        self.type = PostType.Tombstone;
        this._title = null;
        this._content = null;
        this._excerpt = null;
        this._summary = null;
        this._imageUrl = null;
        self.attachments = [];
        this._metadata = null;
    }

    static isDeleted(post: Post) {
        return post.deleted;
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
        this.repostsToRemove.delete(account.id);
        this.repostsToAdd.add(account.id);
    }

    removeRepost(account: Account) {
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

    addMention(account: Account) {
        if (this.mentions.some((m) => m.id === account.id)) {
            return;
        }

        this.mentions.push(account);
    }

    get likeCount() {
        return this._likeCount;
    }

    setLikeCount(count: number) {
        if (this.isInternal) {
            throw new Error(
                'setLikeCount() can only be used for external posts. Use addLike() for internal posts instead.',
            );
        }

        this._likeCount = count;
        this._likeCountDirty = true;
    }

    get repostCount() {
        return this._repostCount;
    }

    setRepostCount(count: number) {
        if (this.author.isInternal) {
            throw new Error(
                'setRepostCount() can only be used for external posts. Use addRepost() for internal posts instead.',
            );
        }

        this._repostCount = count;
        this._repostCountDirty = true;
    }

    get isLikeCountDirty() {
        return this._likeCountDirty;
    }

    get isRepostCountDirty() {
        return this._repostCountDirty;
    }

    get isUpdateDirty() {
        return this._updateDirty;
    }

    clearDirtyFlags() {
        this._likeCountDirty = false;
        this._repostCountDirty = false;
        this._updateDirty = false;
    }

    static async createArticleFromGhostPost(
        account: Account,
        ghostPost: GhostPost,
    ): Promise<Result<Post, CreatePostError>> {
        const isPublic = ghostPost.visibility === 'public';

        let content = ghostPost.html;
        let excerpt = ghostPost.excerpt
            ? PostSummary.parse(ghostPost.excerpt)
            : null;

        const allOptionsDisabled: PrepareContentOptions = {
            removeGatedContent: false,
            removeMemberContent: false,
            escapeHtml: false,
            convertLineBreaks: false,
            wrapInParagraph: false,
            extractLinks: false,
            addPaidContentMessage: false,
            addMentions: false,
        };

        if (content === null || content === '') {
            return error('missing-content');
        }

        content = ContentPreparer.prepare(content, {
            ...allOptionsDisabled,
            removeGatedContent: true,
        });

        if (isPublic === false) {
            content = ContentPreparer.prepare(content, {
                ...allOptionsDisabled,
                removeMemberContent: true,
            });

            if (content === '') {
                return error('private-content');
            }

            if (
                ghostPost.custom_excerpt === null ||
                ghostPost.custom_excerpt === ''
            ) {
                excerpt = ContentPreparer.regenerateExcerpt(content);
            }

            // We add the paid content message _after_ so it doesn't appear in excerpt
            content = ContentPreparer.prepare(content, {
                ...allOptionsDisabled,
                addPaidContentMessage: {
                    url: new URL(ghostPost.url),
                },
            });
        }

        const title = ghostPost.title ? PostTitle.parse(ghostPost.title) : null;
        const summary = ghostPost.custom_excerpt
            ? PostSummary.parse(ghostPost.custom_excerpt)
            : null;

        return ok(
            new Post(
                null,
                randomUUID(),
                account,
                PostType.Article,
                Audience.Public,
                title,
                excerpt,
                summary,
                content,
                new URL(ghostPost.url),
                parseURL(ghostPost.feature_image),
                new Date(ghostPost.published_at),
                {
                    ghostAuthors: ghostPost.authors ?? [],
                },
            ),
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

        if (data.mentions && data.mentions.length > 0) {
            data.content = ContentPreparer.updateMentions(
                data.content ?? '',
                data.mentions,
            );
        }

        const title = data.title
            ? PostTitle.parse(data.title.slice(0, 256))
            : null;
        const excerpt = data.excerpt
            ? ContentPreparer.regenerateExcerpt(data.excerpt)
            : null;
        const summary = data.summary
            ? ContentPreparer.regenerateExcerpt(data.summary)
            : null;

        const post = new Post(
            null,
            null,
            account,
            data.type,
            data.audience ?? Audience.Public,
            title,
            excerpt,
            summary,
            data.content ?? null,
            data.url ?? null,
            data.imageUrl ?? null,
            data.publishedAt ?? new Date(),
            data.metadata ?? null,
            0,
            0,
            0,
            inReplyTo,
            threadRoot,
            null,
            data.attachments ?? [],
            data.apId ?? null,
        );

        for (const mention of data.mentions ?? []) {
            post.addMention(mention.account);
        }

        return post;
    }

    static createNote(
        account: Account,
        noteContent: string,
        image?: ImageAttachment,
        mentions: Mention[] = [],
    ): Post {
        if (!account.isInternal) {
            throw new Error('createNote is for use with internal accounts');
        }

        const content = ContentPreparer.prepare(noteContent, {
            removeGatedContent: false,
            removeMemberContent: false,
            escapeHtml: true,
            convertLineBreaks: true,
            wrapInParagraph: true,
            extractLinks: true,
            addPaidContentMessage: false,
            addMentions: mentions,
        });

        const postAttachment = image
            ? [
                  {
                      type: 'Image',
                      mediaType: null,
                      name: image.altText ?? null,
                      url: image.url,
                  },
              ]
            : [];

        const post = new Post(
            null,
            null,
            account,
            PostType.Note,
            Audience.Public,
            null,
            null,
            null,
            content,
            null,
            null,
            new Date(),
            null,
            0,
            0,
            0,
            null,
            null,
            null,
            postAttachment,
            null,
        );

        for (const mention of mentions) {
            if (mention.account) {
                post.addMention(mention.account);
            }
        }

        return post;
    }

    static createReply(
        account: Account,
        replyContent: string,
        inReplyTo: Post,
        image?: ImageAttachment,
        mentions: Mention[] = [],
    ): Post {
        if (!account.isInternal) {
            throw new Error('createReply is for use with internal accounts');
        }

        if (!inReplyTo.id) {
            throw new Error('Cannot reply to a Post without an id');
        }

        const inReplyToId = inReplyTo.id;
        const threadRootId = inReplyTo.threadRoot ?? inReplyTo.id;

        const content = ContentPreparer.prepare(replyContent, {
            removeGatedContent: false,
            removeMemberContent: false,
            escapeHtml: true,
            convertLineBreaks: true,
            wrapInParagraph: true,
            extractLinks: true,
            addPaidContentMessage: false,
            addMentions: mentions,
        });

        const postAttachment = image
            ? [
                  {
                      type: 'Image',
                      mediaType: null,
                      name: image.altText ?? null,
                      url: image.url,
                  },
              ]
            : [];

        const post = new Post(
            null,
            null,
            account,
            PostType.Note,
            Audience.Public,
            null,
            null,
            null,
            content,
            null,
            null,
            new Date(),
            null,
            0,
            0,
            0,
            inReplyToId,
            threadRootId,
            null,
            postAttachment,
            null,
        );

        for (const mention of mentions) {
            if (mention.account) {
                post.addMention(mention.account);
            }
        }

        return post;
    }
}
