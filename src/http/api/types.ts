import type { Metadata, PostType } from '@/post/post.entity';

/**
 * Base account DTO that can be used across different views
 */
export interface MinimalAccountDTO {
    /**
     * Internal ID of the account
     */
    id: string;
    /**
     * Internal ID of the account
     */
    apId: string;
    /**
     * Display name of the account
     */
    name: string;
    /**
     * Handle of the account
     */
    handle: string;
    /**
     * URL of the avatar of the account
     */
    avatarUrl: string | null;
    /**
     * Whether the account of the current user is followed by this account
     */
    followedByMe: boolean;
    /**
     * Whether the account of the current user is blocking this account
     */
    blockedByMe: boolean;
    /**
     * Whether the account of the current user is blocking this accounts domain
     */
    domainBlockedByMe: boolean;
    /**
     * Whether the current user is following this account
     */
    isFollowing: boolean;
}

/**
 * Account returned by the API - Anywhere an account is returned via the API,
 * it should be this shape, or a partial version of it
 */
export interface AccountDTO extends Omit<MinimalAccountDTO, 'isFollowing'> {
    /**
     * Bio of the account
     */
    bio: string | null;
    /**
     * Public URL of the account
     */
    url: string | null;
    /**
     * URL of the banner image of the account
     */
    bannerImageUrl: string | null;
    /**
     * Custom fields of the account
     */
    customFields: Record<string, string>;
    /**
     * Number of posts created by the account
     */
    postCount: number;
    /**
     * Number of liked posts by the account
     */
    likedCount: number;
    /**
     * Number of accounts this account follows
     */
    followingCount: number;
    /**
     * Number of accounts following this account
     */
    followerCount: number;
    /**
     * Whether the account of the current user is followed by this account
     */
    followsMe: boolean;
}

/**
 * Account returned by the API with Bluesky integration details included
 */
export interface AccountDTOWithBluesky extends AccountDTO {
    /**
     * Whether the account has the Bluesky integration enabled
     */
    blueskyEnabled: boolean;
    /**
     * Handle of the Bluesky account (if enabled)
     */
    blueskyHandle: string | null;
}

export type AuthorDTO = Pick<
    AccountDTO,
    'id' | 'handle' | 'avatarUrl' | 'name' | 'url' | 'followedByMe'
>;

/**
 * Post returned by the API - Anywhere a post is returned via the API,
 * it should be this shape, or a partial version of it
 */
export interface PostDTO {
    /**
     * Internal ID of the post
     */
    id: string;
    /**
     * Type of the post
     */
    type: PostType;
    /**
     * Title of the post
     */
    title: string;
    /**
     * Excerpt of the post
     */
    excerpt: string;
    /**
     * Summary of the post (custom excerpt)
     */
    summary: string | null;
    /**
     * Content of the post
     */
    content: string;
    /**
     * URL of the post
     */
    url: string;
    /**
     * URL of the feature image of the post
     */
    featureImageUrl: string | null;
    /**
     * Date the post was published
     */
    publishedAt: Date;
    /**
     * Number of likes the post has
     */
    likeCount: number;
    /**
     * Whether the current user has liked the post
     */
    likedByMe: boolean;
    /**
     * Number of replies to the post
     */
    replyCount: number;
    /**
     * Reading time of the post in minutes
     */
    readingTimeMinutes: number;
    /**
     * Attachments of the post
     */
    attachments: {
        /**
         * Type of the attachment
         */
        type: string;
        /**
         * Media type of the attachment
         */
        mediaType: string;
        /**
         * Name of the attachment
         */
        name: string;
        /**
         * URL of the attachment
         */
        url: string;
    }[];
    /**
     * Author of the post (partial account)
     */
    author: AuthorDTO;
    /**
     * Whether the current user is the author of the post
     */
    authoredByMe: boolean;
    /**
     * Number of reposts of the post
     */
    repostCount: number;
    /**
     * Whether the current user has reposted the post
     */
    repostedByMe: boolean;
    /**
     * Account that reposted the post
     */
    repostedBy: AuthorDTO | null;
    /**
     * Metadata of the post, containing e.g. information about ghost authors
     */
    metadata?: Metadata | null;
}

/**
 * Notification returned by the API
 */
export interface NotificationDTO {
    /**
     * Internal ID of the notification
     */
    id: string;
    /**
     * Date the notification was created
     */
    createdAt: Date;
    /**
     * Type of the notification
     */
    type: 'like' | 'repost' | 'reply' | 'follow' | 'mention';
    /**
     * Actor of the notification
     */
    actor: AuthorDTO;
    /**
     * Post (partial) associated with the notification
     */
    post:
        | (Pick<
              PostDTO,
              | 'id'
              | 'title'
              | 'content'
              | 'url'
              | 'likeCount'
              | 'replyCount'
              | 'repostCount'
              | 'likedByMe'
              | 'repostedByMe'
              | 'attachments'
          > & {
              type: 'article' | 'note';
          })
        | null;
    /**
     * In reply to post (partial) associated with the notification
     */
    inReplyTo:
        | (Pick<PostDTO, 'id' | 'title' | 'content' | 'url'> & {
              type: 'article' | 'note';
          })
        | null;
}

/**
 * DTO for a blocked domain
 */
export interface BlockedDomainDTO {
    /**
     * The fully qualified URL of the blocked domain
     */
    url: string;
}
