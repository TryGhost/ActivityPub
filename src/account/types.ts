/**
 * Site
 */
export interface Site {
    id: number;
    host: string;
    webhook_secret: string;
    ghost_uuid: string | null;
}

export interface InternalAccountData {
    username: string;
    name?: string;
    bio: string | null;
    avatar_url: string | null;
    banner_image_url: string | null;
}

/**
 * Account
 */
export interface Account {
    id: number;
    username: string;
    name: string | null;
    bio: string | null;
    avatar_url: string | null;
    banner_image_url: string | null;
    url: string | null;
    custom_fields: Record<string, string> | null;
    ap_id: string;
    ap_inbox_url: string;
    ap_shared_inbox_url: string | null;
    ap_outbox_url: string;
    ap_following_url: string;
    ap_followers_url: string;
    ap_liked_url: string;
    ap_public_key: string;
    ap_private_key: string | null;
}

/**
 * Data used when creating an external account
 */
export type ExternalAccountData = Omit<Account, 'id' | 'ap_private_key'>;
