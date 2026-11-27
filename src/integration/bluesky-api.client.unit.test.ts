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
    BLUESKY_API_GET_PROFILE_ENDPOINT,
    BlueskyApiClient,
} from '@/integration/bluesky-api.client';

function mockBlueskyFetch(
    did: string,
    response: () => Promise<Response>,
): void {
    const expectedUrl = `${BLUESKY_API_BASE_URL}/${BLUESKY_API_GET_PROFILE_ENDPOINT}?actor=${encodeURIComponent(did)}`;

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
    const did = 'did:plc:abc123';

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

    describe('getProfile', () => {
        it('should return the DID and handle of the profile', async () => {
            mockBlueskyFetch(did, () =>
                Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({
                        did,
                        handle: 'example.com',
                        displayName: 'Example',
                    }),
                } as Response),
            );

            const result = await client.getProfile(did);

            expect(isError(result)).toBe(false);
            expect(getValue(result as Ok<unknown>)).toEqual({
                did,
                handle: 'example.com',
            });
        });

        it.each([400, 404])(
            'should return a not-found error when the response is %s',
            async (status) => {
                mockBlueskyFetch(did, () =>
                    Promise.resolve({ ok: false, status } as Response),
                );

                const result = await client.getProfile(did);

                expect(getError(result as ResultError<unknown>)).toEqual({
                    type: 'not-found',
                });
            },
        );

        it('should return an api-error when the response is not ok', async () => {
            mockBlueskyFetch(did, () =>
                Promise.resolve({ ok: false, status: 500 } as Response),
            );

            const result = await client.getProfile(did);

            expect(getError(result as ResultError<unknown>)).toMatchObject({
                type: 'api-error',
                status: 500,
            });
        });

        it('should return a network-error when the fetch fails', async () => {
            mockBlueskyFetch(did, () =>
                Promise.reject(new TypeError('Network request failed')),
            );

            const result = await client.getProfile(did);

            expect(getError(result as ResultError<unknown>)).toMatchObject({
                type: 'network-error',
                message: 'Network request failed',
            });
        });
    });
});
