import { parseURL } from '@/core/url';

/**
 * Helpers for ActivityStreams `Hashtag` tags.
 *
 * Hashtag names follow the conventions used across the Fediverse (Mastodon,
 * Pleroma, Misskey): word characters only, with at least one letter. Names are
 * matched case-insensitively, so they are normalized before being stored or
 * looked up.
 */

/**
 * A hashtag together with the URL it links to
 */
export interface HashtagLink {
    /**
     * Hashtag name, without the leading `#`
     */
    name: string;
    href: URL;
}

/**
 * A Ghost tag, as included in Ghost's post webhooks
 */
export interface GhostTag {
    name: string;
    url: string;
}

/**
 * Maximum length of a hashtag name, in code points. Matches the size of the
 * `hashtags.name` column.
 */
const MAX_HASHTAG_LENGTH = 255;

const HASHTAG_NAME_REGEX = /^[\p{L}\p{M}\p{N}_]+$/u;
const HASHTAG_LETTER_REGEX = /\p{L}/u;
const NON_WORD_REGEX = /[^\p{L}\p{M}\p{N}_]+/u;

/**
 * Normalize a hashtag name for storage and lookups.
 *
 * Strips a leading `#`, applies Unicode NFKC normalization and lowercases the
 * name. Returns `null` if the result is not a valid hashtag name.
 *
 * @param name Hashtag name, with or without a leading `#`
 */
export function normalizeHashtag(name: string): string | null {
    const normalized = name.replace(/^#/, '').normalize('NFKC').toLowerCase();

    if (!isValidHashtagName(normalized)) {
        return null;
    }

    return normalized;
}

/**
 * Normalize the start of a hashtag name, e.g. a search query, like
 * `normalizeHashtag`. Unlike a full name it needn't contain a letter, as
 * `2026` can start `2026news`. Returns `null` if no hashtag name can start
 * with it.
 *
 * @param prefix Start of a hashtag name, with or without a leading `#`
 */
export function normalizeHashtagPrefix(prefix: string): string | null {
    const normalized = prefix.replace(/^#/, '').normalize('NFKC').toLowerCase();

    if (
        [...normalized].length > MAX_HASHTAG_LENGTH ||
        !HASHTAG_NAME_REGEX.test(normalized)
    ) {
        return null;
    }

    return normalized;
}

/**
 * Normalize and deduplicate a list of hashtag names, dropping invalid ones.
 *
 * @param names Hashtag names, with or without a leading `#`
 */
export function normalizeHashtags(names: string[]): string[] {
    const normalized = new Set<string>();

    for (const name of names) {
        const hashtag = normalizeHashtag(name);

        if (hashtag !== null) {
            normalized.add(hashtag);
        }
    }

    return [...normalized];
}

/**
 * Convert a Ghost tag name into a hashtag name.
 *
 * Ghost tag names may contain spaces and punctuation, which hashtags can't.
 * Multi-word names are joined in CamelCase so they stay readable, e.g.
 * "Getting Started" becomes "GettingStarted". Returns `null` if the tag name
 * does not produce a valid hashtag name.
 *
 * @param tagName Ghost tag name
 */
export function getHashtagNameFromGhostTag(tagName: string): string | null {
    const words = tagName
        .normalize('NFKC')
        .split(NON_WORD_REGEX)
        .filter(Boolean);

    const name =
        words.length === 1
            ? words[0]
            : words
                  .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                  .join('');

    if (!isValidHashtagName(name ?? '')) {
        return null;
    }

    return name;
}

/**
 * Get the hashtags for a Ghost post's tags. Tags that don't produce a valid
 * hashtag name or have an invalid URL are skipped, as are duplicates.
 *
 * @param tags Public tags of the Ghost post
 */
export function getHashtagLinksFromGhostTags(tags: GhostTag[]): HashtagLink[] {
    const hashtagLinks = new Map<string, HashtagLink>();

    for (const tag of tags) {
        const name = getHashtagNameFromGhostTag(tag.name);
        const href = parseURL(tag.url);

        if (name === null || href === null) {
            continue;
        }

        const normalized = normalizeHashtag(name);

        if (normalized !== null && !hashtagLinks.has(normalized)) {
            hashtagLinks.set(normalized, { name, href });
        }
    }

    return [...hashtagLinks.values()];
}

/**
 * Get the URL of a Ghost site's tag archive page for a hashtag.
 *
 * Ghost serves tag archives at `/tag/:slug/` by default. Hashtag names only
 * contain word characters, so the lowercased name is used as the slug.
 *
 * @param siteUrl URL of the Ghost site
 * @param name Hashtag name, without a leading `#`
 */
export function getHashtagUrl(siteUrl: URL, name: string): URL {
    const base = siteUrl.href.endsWith('/') ? siteUrl.href : `${siteUrl.href}/`;

    return new URL(`tag/${encodeURIComponent(name.toLowerCase())}/`, base);
}

function isValidHashtagName(name: string): boolean {
    return (
        [...name].length <= MAX_HASHTAG_LENGTH &&
        HASHTAG_NAME_REGEX.test(name) &&
        HASHTAG_LETTER_REGEX.test(name)
    );
}
