export interface Account {
    id: string | null;
    name: string | null;
    handle: string;
    bio: string;
    url: string | null;
    avatarUrl: string | null;
    bannerUrl: string | null;
    customFields: Record<string, string>;
    followingCount: number;
    followerCount: number;
    followsMe: boolean;
    followedByMe: boolean;
}
