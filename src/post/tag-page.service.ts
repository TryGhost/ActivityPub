import type { Logger } from '@logtape/logtape';

import { getHashtagUrl } from '@/post/hashtag';

const CHECK_TIMEOUT_MS = 2000;
const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX_ENTRIES = 10_000;

/**
 * Checks which hashtags have a tag page on a Ghost site, so that a note only
 * links a hashtag to a page that exists.
 *
 * Results are cached per tag page, as a site tends to reuse its hashtags.
 * Concurrent checks of the same page share one request. A failed request is
 * not cached, so a slow or unreachable site doesn't leave hashtags unlinked
 * for longer than one note.
 */
export class TagPageService {
    private readonly cache = new Map<
        string,
        { exists: Promise<boolean>; expiresAt: number }
    >();

    constructor(private readonly logging: Logger) {}

    /**
     * Get the hashtags that have a tag page on a site
     *
     * @param siteUrl URL of the site
     * @param hashtags Normalized hashtag names
     */
    async getHashtagsWithTagPage(
        siteUrl: URL,
        hashtags: string[],
    ): Promise<Set<string>> {
        const results = await Promise.all(
            hashtags.map(async (hashtag) => ({
                hashtag,
                exists: await this.hasTagPage(getHashtagUrl(siteUrl, hashtag)),
            })),
        );

        return new Set(
            results
                .filter((result) => result.exists)
                .map((result) => result.hashtag),
        );
    }

    private hasTagPage(url: URL): Promise<boolean> {
        const key = url.href;
        const now = Date.now();
        const cached = this.cache.get(key);

        if (cached && cached.expiresAt > now) {
            return cached.exists;
        }

        const exists = this.requestTagPage(url).then((result) => {
            if (result === null && this.cache.get(key)?.exists === exists) {
                this.cache.delete(key);
            }

            return result === true;
        });

        // Re-inserting moves the entry to the end of the map, which keeps the
        // map ordered from the oldest to the newest entry
        this.cache.delete(key);

        if (this.cache.size >= CACHE_MAX_ENTRIES) {
            const oldestKey = this.cache.keys().next().value;

            if (oldestKey !== undefined) {
                this.cache.delete(oldestKey);
            }
        }

        this.cache.set(key, { exists, expiresAt: now + CACHE_TTL_MS });

        return exists;
    }

    /**
     * Request a tag page, returning whether it exists or null if the site
     * could not be reached
     */
    private async requestTagPage(url: URL): Promise<boolean | null> {
        try {
            const response = await fetch(url, {
                method: 'HEAD',
                redirect: 'follow',
                signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
            });

            return response.ok;
        } catch (err) {
            this.logging.warn('Failed to check tag page {url}', {
                url: url.href,
                error: err,
            });

            return null;
        }
    }
}
