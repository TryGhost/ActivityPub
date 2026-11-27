import { UrlError, validatePublicUrl } from '@fedify/vocab-runtime';
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
 * Concurrent checks of the same page share one request. A request that fails,
 * is rate limited or gets a server error is not cached, so a slow or
 * struggling site doesn't leave hashtags unlinked for longer than one note.
 *
 * The site controls where its tag pages point, so the check refuses private
 * addresses and doesn't follow redirects. Otherwise a site could make the
 * server send requests to internal addresses.
 */
export class TagPageService {
    private readonly cache = new Map<
        string,
        { exists: Promise<boolean>; expiresAt: number }
    >();

    constructor(
        private readonly logging: Logger,
        private readonly allowPrivateAddress: boolean,
    ) {}

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
     * Request a tag page, returning whether it exists or null if the answer
     * may change soon
     */
    private async requestTagPage(url: URL): Promise<boolean | null> {
        try {
            if (!this.allowPrivateAddress) {
                await validatePublicUrl(url.href);
            }

            // Ghost serves a tag page at the URL with the trailing slash, so
            // a redirect means the page is missing or somewhere else
            const response = await fetch(url, {
                method: 'HEAD',
                redirect: 'manual',
                signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
            });

            if (response.ok) {
                return true;
            }

            const isRedirect = response.status >= 300 && response.status < 400;
            const isMissing =
                response.status === 404 || response.status === 410;

            return isRedirect || isMissing ? false : null;
        } catch (err) {
            if (err instanceof UrlError && err.reason === 'disallowed') {
                this.logging.warn('Refused to check tag page {url}', {
                    url: url.href,
                    error: err,
                });

                return false;
            }

            this.logging.warn('Failed to check tag page {url}', {
                url: url.href,
                error: err,
            });

            return null;
        }
    }
}
