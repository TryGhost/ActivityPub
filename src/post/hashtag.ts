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
 * Maximum length of a hashtag name, in code points. Matches the size of the
 * `hashtags.name` column.
 */
const MAX_HASHTAG_LENGTH = 255;

const HASHTAG_NAME_REGEX = /^[\p{L}\p{M}\p{N}_]+$/u;
const HASHTAG_LETTER_REGEX = /\p{L}/u;

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
