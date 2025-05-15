import { randomUUID } from 'node:crypto';
import { sanitizeHtml } from 'helpers/html';
import type { Account } from '../account/account.entity';
import { BaseEntity } from '../core/base.entity';
import { parseURL } from '../core/url';
import { ContentPreparer } from './content';

export enum PostType {
    Note = 0,
    Article = 1,
    Tombstone = 2,
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
interface GhostPost {
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

export interface PostData {
    type: CreatePostType;
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
    mentions?: Account[] | null;
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

export class Post extends BaseEntity {
    public readonly uuid: string;
    public readonly apId: URL;
    public readonly url: URL;
    private likesToRemove: Set<number> = new Set();
    private likesToAdd: Set<number> = new Set();
    private mentionsToAdd: Set<number> = new Set();
    private repostsToAdd: Set<number> = new Set();
    private repostsToRemove: Set<number> = new Set();
    private deleted = false;
    public readonly content: string | null;

    constructor(
        public readonly id: number | null,
        uuid: string | null,
        public readonly author: Account,
        public readonly type: CreatePostType,
        public readonly audience: Audience,
        public readonly title: string | null,
        public readonly excerpt: string | null,
        content: string | null,
        url: URL | null,
        public readonly imageUrl: URL | null,
        public readonly publishedAt: Date,
        public readonly metadata: Metadata | null = null,
        public readonly likeCount = 0,
        public readonly repostCount = 0,
        public readonly replyCount = 0,
        public readonly inReplyTo: number | null = null,
        public readonly threadRoot: number | null = null,
        private readonly _readingTimeMinutes: number | null = null,
        public readonly attachments: PostAttachment[] = [],
        apId: URL | null = null,
        _deleted = false,
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
            this.url = this.apId;
        } else {
            this.url = url;
        }
        this.content = content !== null ? sanitizeHtml(content) : null;
        if (_deleted) {
            this.deleted = true;
            this.handleDeleted();
        }
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

    private handleDeleted() {
        // TODO: Clean up the any type
        // biome-ignore lint/suspicious/noExplicitAny: Legacy code needs proper typing
        const self = this as any;
        self.type = PostType.Tombstone;
        self.title = null;
        self.content = null;
        self.excerpt = null;
        self.imageUrl = null;
        self.attachments = [];
        self.metadata = null;
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
        this.mentionsToAdd.add(account.id);
    }

    getMentions() {
        const mentionsToAdd = [...this.mentionsToAdd.values()];
        this.mentionsToAdd.clear();
        return mentionsToAdd;
    }

    static createArticleFromGhostPost(
        account: Account,
        ghostPost: GhostPost,
    ): Post {
        const isPublic = ghostPost.visibility === 'public';

        let content = ghostPost.html;
        let excerpt = ghostPost.excerpt;
        if (isPublic === false && ghostPost.html !== null) {
            content = ContentPreparer.prepare(ghostPost.html, {
                removeMemberContent: true,
                escapeHtml: false,
                convertLineBreaks: false,
                wrapInParagraph: false,
                extractLinks: false,
                addPaidContentMessage: false,
                addMentions: false,
            });

            if (content === '') {
                throw new Error('Cannot create Post from private content');
            }

            if (
                ghostPost.custom_excerpt === null ||
                ghostPost.custom_excerpt === ''
            ) {
                excerpt = ContentPreparer.regenerateExcerpt(content);
            }

            // We add the paid content message _after_ so it doesn't appear in excerpt
            content = ContentPreparer.prepare(content, {
                removeMemberContent: false,
                escapeHtml: false,
                convertLineBreaks: false,
                wrapInParagraph: false,
                extractLinks: false,
                addPaidContentMessage: {
                    url: new URL(ghostPost.url),
                },
                addMentions: false,
            });
        }

        return new Post(
            null,
            ghostPost.uuid,
            account,
            PostType.Article,
            Audience.Public,
            ghostPost.title,
            excerpt,
            content,
            new URL(ghostPost.url),
            parseURL(ghostPost.feature_image),
            new Date(ghostPost.published_at),
            {
                ghostAuthors: ghostPost.authors ?? [],
            },
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

        const post = new Post(
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
            post.addMention(mention);
        }

        return post;
    }

    static createNote(
        account: Account,
        noteContent: string,
        imageUrl?: URL,
        mentions: Mention[] = [],
    ): Post {
        if (!account.isInternal) {
            throw new Error('createNote is for use with internal accounts');
        }

        const content = ContentPreparer.prepare(noteContent, {
            removeMemberContent: false,
            escapeHtml: true,
            convertLineBreaks: true,
            wrapInParagraph: true,
            extractLinks: true,
            addPaidContentMessage: false,
            addMentions: mentions,
        });

        const postAttachment = imageUrl
            ? [
                  {
                      type: 'Image',
                      mediaType: null,
                      name: null,
                      url: imageUrl,
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
        imageUrl?: URL,
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
            removeMemberContent: false,
            escapeHtml: true,
            convertLineBreaks: true,
            wrapInParagraph: true,
            extractLinks: true,
            addPaidContentMessage: false,
            addMentions: mentions,
        });

        const postAttachment = imageUrl
            ? [
                  {
                      type: 'Image',
                      mediaType: null,
                      name: null,
                      url: imageUrl,
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
