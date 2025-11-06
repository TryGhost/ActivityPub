import { describe, expect, it, mock } from 'bun:test';

import { searchBlueskyHandle } from './index';

describe('searchBlueskyHandle', () => {
    it('should return handle when actor with bridgy label is found', async () => {
        const mockResponse = {
            actors: [
                {
                    did: 'did:plc:example',
                    handle: 'example.com.ap.brid.gy',
                    displayName: 'Example Site',
                    labels: [
                        {
                            src: 'did:plc:example',
                            uri: 'at://did:plc:example/app.bsky.actor.profile/self',
                            cid: 'bafyreih...',
                            val: 'bridged-from-bridgy-fed-activitypub',
                            cts: '1970-01-01T00:00:00.000Z',
                        },
                    ],
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
                    labels: [
                        {
                            src: 'did:plc:example',
                            uri: 'at://did:plc:example/app.bsky.actor.profile/self',
                            cid: 'bafyreih...',
                            val: 'bridged-from-bridgy-fed-activitypub',
                            cts: '1970-01-01T00:00:00.000Z',
                        },
                    ],
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

    it('should match handle with bridgy label regardless of hostname', async () => {
        const mockResponse = {
            actors: [
                {
                    did: 'did:plc:example',
                    handle: 'feed.example.com.ap.brid.gy',
                    displayName: 'Example Site',
                    labels: [
                        {
                            src: 'did:plc:example',
                            uri: 'at://did:plc:example/app.bsky.actor.profile/self',
                            cid: 'bafyreih...',
                            val: 'bridged-from-bridgy-fed-activitypub',
                            cts: '1970-01-01T00:00:00.000Z',
                        },
                    ],
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

        expect(result).toBe('feed.example.com.ap.brid.gy');
    });

    it('should not match handles without bridgy label', async () => {
        const mockResponse = {
            actors: [
                {
                    did: 'did:plc:example',
                    handle: 'example.com.ap.brid.gy',
                    displayName: 'Example Site',
                    labels: [
                        {
                            src: 'did:plc:example',
                            uri: 'at://did:plc:example/app.bsky.actor.profile/self',
                            cid: 'bafyreih...',
                            val: 'some-other-label',
                            cts: '1970-01-01T00:00:00.000Z',
                        },
                    ],
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

    it('should not match handles without labels array', async () => {
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

        expect(result).toBeNull();
    });

    it('should prefer valid handle over handle.invalid', async () => {
        const mockResponse = {
            actors: [
                {
                    did: 'did:plc:invalid',
                    handle: 'handle.invalid',
                    displayName: 'Example Site',
                    labels: [
                        {
                            src: 'did:plc:invalid',
                            uri: 'at://did:plc:invalid/app.bsky.actor.profile/self',
                            cid: 'bafyreih...',
                            val: 'bridged-from-bridgy-fed-activitypub',
                            cts: '1970-01-01T00:00:00.000Z',
                        },
                    ],
                },
                {
                    did: 'did:plc:valid',
                    handle: 'example.com.ap.brid.gy',
                    displayName: 'Example Site',
                    labels: [
                        {
                            src: 'did:plc:valid',
                            uri: 'at://did:plc:valid/app.bsky.actor.profile/self',
                            cid: 'bafyreih...',
                            val: 'bridged-from-bridgy-fed-activitypub',
                            cts: '1970-01-01T00:00:00.000Z',
                        },
                    ],
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
    });

    it('should return null when only handle.invalid is found', async () => {
        const mockResponse = {
            actors: [
                {
                    did: 'did:plc:invalid',
                    handle: 'handle.invalid',
                    displayName: 'Example Site',
                    labels: [
                        {
                            src: 'did:plc:invalid',
                            uri: 'at://did:plc:invalid/app.bsky.actor.profile/self',
                            cid: 'bafyreih...',
                            val: 'bridged-from-bridgy-fed-activitypub',
                            cts: '1970-01-01T00:00:00.000Z',
                        },
                    ],
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
