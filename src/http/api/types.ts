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
