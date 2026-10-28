import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Logger } from '@logtape/logtape';

import {
    getError,
    getValue,
    type Ok,
    type Error as ResultError,
} from '@/core/result';
import {
    BRIDGY_FED_ATPROTO_DID_URL,
    BridgyFedClient,
} from '@/integration/bridgy-fed.client';

describe('BridgyFedClient', () => {
    const apId = new URL('https://example.com/.ghost/activitypub/users/index');
    const expectedUrl = `${BRIDGY_FED_ATPROTO_DID_URL}?protocol=ap&id=${encodeURIComponent(apId.href)}`;

    let client: BridgyFedClient;

    beforeEach(() => {
        client = new BridgyFedClient({
            warn: vi.fn(),
            error: vi.fn(),
        } as unknown as Logger);

        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    describe('getBridgedDid', () => {
        it('should return the DID of the bridged account', async () => {
            vi.mocked(fetch).mockResolvedValue(
                new Response('did:plc:abc123', { status: 200 }),
            );

            const result = await client.getBridgedDid(apId);

            expect(fetch).toHaveBeenCalledWith(
                expectedUrl,
                expect.objectContaining({ method: 'GET' }),
            );
            expect(getValue(result as Ok<unknown>)).toBe('did:plc:abc123');
        });

        it('should return a not-found error when the actor is not bridged', async () => {
            vi.mocked(fetch).mockResolvedValue(
                new Response('<html>Not found</html>', { status: 404 }),
            );

            const result = await client.getBridgedDid(apId);

            expect(getError(result as ResultError<unknown>)).toEqual({
                type: 'not-found',
            });
        });

        it('should return a not-found error when the response is not a DID', async () => {
            vi.mocked(fetch).mockResolvedValue(
                new Response('<html>Hello</html>', { status: 200 }),
            );

            const result = await client.getBridgedDid(apId);

            expect(getError(result as ResultError<unknown>)).toEqual({
                type: 'not-found',
            });
        });

        it('should return an api-error when the response is not ok', async () => {
            vi.mocked(fetch).mockResolvedValue(
                new Response('Error', { status: 503 }),
            );

            const result = await client.getBridgedDid(apId);

            expect(getError(result as ResultError<unknown>)).toMatchObject({
                type: 'api-error',
                status: 503,
            });
        });

        it('should return a network-error when the fetch fails', async () => {
            vi.mocked(fetch).mockRejectedValue(new TypeError('fetch failed'));

            const result = await client.getBridgedDid(apId);

            expect(getError(result as ResultError<unknown>)).toMatchObject({
                type: 'network-error',
                message: 'fetch failed',
            });
        });
    });
});
