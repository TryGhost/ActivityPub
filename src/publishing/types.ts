import type { Temporal } from '@js-temporal/polyfill';

/**
 * Visibility of a post
 */
export enum PostVisibility {
    /**
     * Public post
     */
    Public = 'public',
    /**
     * Members-only post
     */
    Members = 'members',
    /**
     * Paid post
     */
    Paid = 'paid',
    /**
     * Tiers post
     */
    Tiers = 'tiers',
}

type GhostAuthor = {
    name: string;
    profile_image: string | null;
};

type Metadata = {
    ghostAuthors: GhostAuthor[];
} & Record<string, unknown>;

/**
 * Post to be published to the Fediverse
 */
export interface Post {
    /**
     * Unique identifier of the post
     */
    id: string;
    /**
     * Title of the post
     */
    title: string;
    /**
     * Content of the post
     */
    content: string | null;
    /**
     * Excerpt of the post
     */
    excerpt: string | null;
    /**
     * URL to the post's feature image
     */
    featureImageUrl: URL | null;
    /**
     * Published date of the post
     */
    publishedAt: Temporal.Instant;
    /**
     * URL to the post
     */
    url: URL;
    /**
     * Visibility of the post
     */
    visibility: PostVisibility;
    /**
     * Information about the post's author
     */
    author: {
        /**
         * The author's Fediverse handle
         */
        handle: string;
    };
    /**
     * Additional metadata used when rendering the post
     */
    metadata: Metadata | null;
}

/**
 * Note to be published to the Fediverse
 */
export interface Note {
    /**
     * Content of the note
     */
    content: string;
    /**
     * Information about the post's author
     */
    author: {
        /**
         * The author's Fediverse handle
         */
        handle: string;
    };
    /**
     * The AP ID of the post
     */
    apId?: URL;
    /**
     * The image URL if an image is attached with the note
     */
    imageUrl?: URL | null;
}
