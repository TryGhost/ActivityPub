import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Logger } from '@logtape/logtape';

import {
    getError,
    getValue,
    isError,
    type Ok,
    type Error as ResultError,
} from '@/core/result';
import {
    BLUESKY_API_BASE_URL,
    BLUESKY_API_SEARCH_ACTORS_ENDPOINT,
    BlueskyApiClient,
} from '@/integration/bluesky-api.client';

function mockBlueskyFetch(
    query: string,
    response: () => Promise<Response>,
): void {
    const expectedUrl = `${BLUESKY_API_BASE_URL}/${BLUESKY_API_SEARCH_ACTORS_ENDPOINT}?q=${encodeURIComponent(query)}`;

    vi.mocked(fetch).mockImplementation((url, options) => {
        const headers = options?.headers as Record<string, string> | undefined;
        const hasCorrectContentType =
            headers && headers['Content-Type'] === 'application/json';

        if (
            url === expectedUrl &&
            options &&
            options.method === 'GET' &&
            hasCorrectContentType &&
            options.signal instanceof AbortSignal
        ) {
            return response();
        }

        return Promise.reject(new Error('Unexpected fetch call'));
    });
}

describe('BlueskyApiClient', () => {
    let client: BlueskyApiClient;
    let logger: Logger;

    beforeEach(() => {
        logger = {
            warn: vi.fn(),
            error: vi.fn(),
        } as unknown as Logger;

        client = new BlueskyApiClient(logger);

        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('should return an array of actors when actors are found', async () => {
        const query = 'example.com';
        const actors = [
            {
                handle: 'test.example.com.ap.brid.gy',
                labels: [
                    {
                        val: 'bridged-from-bridgy-fed-activitypub',
                    },
                ],
            },
            {
                handle: 'other.bsky.social',
            },
        ];

        mockBlueskyFetch(query, () =>
            Promise.resolve({
                ok: true,
                json: async () => ({
                    actors,
                }),
            } as Response),
        );

        const result = await client.searchActors(query);

        expect(isError(result)).toBe(false);
        expect(getValue(result as Ok<unknown>)).toEqual(actors);
    });

    it('should return an empty array when no actors are found', async () => {
        const query = 'example.com';

        mockBlueskyFetch(query, () =>
            Promise.resolve({
                ok: true,
                json: async () => ({
                    actors: [],
                }),
            } as Response),
        );

        const result = await client.searchActors(query);

        expect(isError(result)).toBe(false);
        expect(getValue(result as Ok<unknown>)).toEqual([]);
    });

    it('should return an api-error when the response is not ok', async () => {
        const query = 'example.com';

        mockBlueskyFetch(query, () =>
            Promise.resolve({
                ok: false,
                status: 500,
            } as Response),
        );

        const result = await client.searchActors(query);

        expect(isError(result)).toBe(true);

        expect(getError(result as ResultError<unknown>)).toMatchObject({
            type: 'api-error',
            status: 500,
        });
    });

    it('should return a network-error when the fetch fails', async () => {
        const query = 'example.com';

        mockBlueskyFetch(query, () =>
            Promise.reject(new TypeError('Network request failed')),
        );

        const result = await client.searchActors(query);

        expect(isError(result)).toBe(true);

        expect(getError(result as ResultError<unknown>)).toMatchObject({
            type: 'network-error',
            message: 'Network request failed',
        });
    });

    it('should return a network-error when the request times out', async () => {
        const query = 'example.com';

        const timeoutError = new globalThis.Error('Timeout');
        timeoutError.name = 'TimeoutError';

        mockBlueskyFetch(query, () => Promise.reject(timeoutError));

        const result = await client.searchActors(query);

        expect(isError(result)).toBe(true);

        expect(getError(result as ResultError<unknown>)).toMatchObject({
            type: 'network-error',
            message: 'Timeout',
        });
    });
});
