import { describe, expect, it, mock } from 'bun:test';
import { searchBlueskyHandle } from './index';

describe('searchBlueskyHandle', () => {
    it('should return handle when actor with .ap.brid.gy handle is found', async () => {
        const mockResponse = {
            actors: [
                {
                    did: 'did:plc:example',
                    handle: 'example.com.ap.brid.gy',
                    displayName: 'Example Site',
                },
            ],
        };

        global.fetch = mock(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve(mockResponse),
            }),
        ) as unknown as typeof fetch;

        const result = await searchBlueskyHandle('example.com');

        expect(result).toBe('example.com.ap.brid.gy');
        expect(global.fetch).toHaveBeenCalledWith(
            'https://public.api.bsky.app/xrpc/app.bsky.actor.searchActors?q=example.com',
            {
                headers: {
                    Accept: 'application/json',
                },
            },
        );
    });

    it('should return null when no matching actor is found', async () => {
        const mockResponse = {
            actors: [
                {
                    did: 'did:plc:other',
                    handle: 'other.bsky.social',
                    displayName: 'Other User',
                },
            ],
        };

        global.fetch = mock(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve(mockResponse),
            }),
        ) as unknown as typeof fetch;

        const result = await searchBlueskyHandle('example.com');

        expect(result).toBeNull();
    });

    it('should return null when API returns empty actors array', async () => {
        const mockResponse = {
            actors: [],
        };

        global.fetch = mock(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve(mockResponse),
            }),
        ) as unknown as typeof fetch;

        const result = await searchBlueskyHandle('example.com');

        expect(result).toBeNull();
    });

    it('should return null when API returns permanent error status', async () => {
        global.fetch = mock(() =>
            Promise.resolve({
                ok: false,
                status: 400,
            }),
        ) as unknown as typeof fetch;

        const result = await searchBlueskyHandle('example.com', 1);

        expect(result).toBeNull();
    });

    it('should retry and return null after max retries', async () => {
        global.fetch = mock(() =>
            Promise.resolve({
                ok: false,
                status: 408,
            }),
        ) as unknown as typeof fetch;

        const result = await searchBlueskyHandle('example.com', 2);

        expect(result).toBeNull();
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should retry and succeed on second attempt', async () => {
        let callCount = 0;

        const mockResponse = {
            actors: [
                {
                    did: 'did:plc:example',
                    handle: 'example.com.ap.brid.gy',
                    displayName: 'Example Site',
                },
            ],
        };

        global.fetch = mock(() => {
            callCount++;

            if (callCount === 1) {
                return Promise.resolve({
                    ok: false,
                    status: 503,
                });
            }

            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve(mockResponse),
            });
        }) as unknown as typeof fetch;

        const result = await searchBlueskyHandle('example.com', 3);

        expect(result).toBe('example.com.ap.brid.gy');
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should match handle with exact hostname', async () => {
        const mockResponse = {
            actors: [
                {
                    did: 'did:plc:example',
                    handle: 'www.example.com.ap.brid.gy',
                    displayName: 'Example Site',
                },
            ],
        };

        global.fetch = mock(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve(mockResponse),
            }),
        ) as unknown as typeof fetch;

        const result = await searchBlueskyHandle('www.example.com');

        expect(result).toBe('www.example.com.ap.brid.gy');
    });

    it('should not match handles that contain hostname but are not bridgy handles', async () => {
        const mockResponse = {
            actors: [
                {
                    did: 'did:plc:example',
                    handle: 'example.com.otherdomain.com',
                    displayName: 'Example Site',
                },
            ],
        };

        global.fetch = mock(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve(mockResponse),
            }),
        ) as unknown as typeof fetch;

        const result = await searchBlueskyHandle('example.com');

        expect(result).toBeNull();
    });
});
