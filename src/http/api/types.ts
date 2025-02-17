import type { PostType } from '../../feed/types';

/**
 * Account returned by the API - Anywhere an account is returned via the API,
 * it should be this shape, or a partial version of it
 */
export interface Account {
    /**
     * Internal ID of the account
     */
    id: string;
    /**
     * Display name of the account
     */
    name: string;
    /**
     * Handle of the account
     */
    handle: string;
    /**
     * Bio of the account
     */
    bio: string;
    /**
     * Public URL of the account
     */
    url: string;
    /**
     * URL of the avatar of the account
     */
    avatarUrl: string;
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
    /**
     * Whether the account of the current user is following this account
     */
    followedByMe: boolean;
}

/**
 * Post returned by the API - Anywhere a post is returned via the API,
 * it should be this shape, or a partial version of it
 */
export interface Post {
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
    publishedAt: string;
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
    author: Pick<Account, 'id' | 'handle' | 'avatarUrl' | 'name' | 'url'>;
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
    repostedBy: Pick<
        Account,
        'id' | 'handle' | 'avatarUrl' | 'name' | 'url'
    > | null;
}
