import { type Context, lookupWebFinger } from '@fedify/fedify';
import type { ContextData } from 'app';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lookupAPIdByHandle, lookupActorProfile } from './lookup-helpers';

vi.mock('@fedify/fedify', () => ({
    lookupWebFinger: vi.fn(),
}));

describe('lookupAPIdByHandle', () => {
    const mockCtx = {
        data: {
            logger: {
                info: vi.fn(),
                error: vi.fn(),
            },
        },
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should handle handles with leading @', async () => {
        const mockWebFingerResponse = {
            links: [
                {
                    rel: 'self',
                    type: 'application/activity+json',
                    href: 'https://example.com/actor',
                },
            ],
        };

        (
            lookupWebFinger as unknown as ReturnType<typeof vi.fn>
        ).mockResolvedValue(mockWebFingerResponse);

        const result = await lookupAPIdByHandle(
            mockCtx as unknown as Context<ContextData>,
            '@user@example.com',
        );

        expect(lookupWebFinger).toHaveBeenCalledWith('acct:user@example.com', {
            allowPrivateAddress: true,
        });
        expect(result).toBe('https://example.com/actor');
    });

    it('should return null when WebFinger response has no links', async () => {
        const mockWebFingerResponse = {
            links: [],
        };

        (
            lookupWebFinger as unknown as ReturnType<typeof vi.fn>
        ).mockResolvedValue(mockWebFingerResponse);

        const result = await lookupAPIdByHandle(
            mockCtx as unknown as Context<ContextData>,
            'user@example.com',
        );

        expect(result).toBeNull();
    });

    it('should return null when WebFinger response has no self link', async () => {
        const mockWebFingerResponse = {
            links: [
                {
                    rel: 'other',
                    type: 'application/activity+json',
                    href: 'https://example.com/actor',
                },
            ],
        };

        (
            lookupWebFinger as unknown as ReturnType<typeof vi.fn>
        ).mockResolvedValue(mockWebFingerResponse);

        const result = await lookupAPIdByHandle(
            mockCtx as unknown as Context<ContextData>,
            'user@example.com',
        );

        expect(result).toBeNull();
    });

    it('should return null when WebFinger lookup fails', async () => {
        (
            lookupWebFinger as unknown as ReturnType<typeof vi.fn>
        ).mockRejectedValue(new Error('WebFinger lookup failed'));

        const result = await lookupAPIdByHandle(
            mockCtx as unknown as Context<ContextData>,
            'user@example.com',
        );

        expect(result).toBeNull();
    });

    it('should handle WebFinger response with multiple links and return self link', async () => {
        const mockWebFingerResponse = {
            links: [
                {
                    rel: 'other',
                    type: 'application/activity+json',
                    href: 'https://example.com/other',
                },
                {
                    rel: 'self',
                    type: 'application/activity+json',
                    href: 'https://example.com/actor',
                },
            ],
        };

        (
            lookupWebFinger as unknown as ReturnType<typeof vi.fn>
        ).mockResolvedValue(mockWebFingerResponse);

        const result = await lookupAPIdByHandle(
            mockCtx as unknown as Context<ContextData>,
            'user@example.com',
        );

        expect(result).toBe('https://example.com/actor');
    });
});

describe('lookupActorProfile', () => {
    const mockCtx = {
        data: {
            logger: {
                info: vi.fn(),
                error: vi.fn(),
            },
        },
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return both profile page URL and apId when available', async () => {
        const mockWebFingerResponse = {
            links: [
                {
                    rel: 'self',
                    type: 'application/activity+json',
                    href: 'https://example.com/actor',
                },
                {
                    rel: 'http://webfinger.net/rel/profile-page',
                    href: 'https://example.com/profile',
                },
            ],
        };

        (
            lookupWebFinger as unknown as ReturnType<typeof vi.fn>
        ).mockResolvedValue(mockWebFingerResponse);

        const result = await lookupActorProfile(
            mockCtx as unknown as Context<ContextData>,
            'user@example.com',
        );

        expect(lookupWebFinger).toHaveBeenCalledWith('acct:user@example.com', {
            allowPrivateAddress: true,
        });
        expect(result).toEqual({
            profileUrl: new URL('https://example.com/profile'),
            apId: new URL('https://example.com/actor'),
        });
    });

    it('should return only apid when profile page is not available', async () => {
        const mockWebFingerResponse = {
            links: [
                {
                    rel: 'self',
                    type: 'application/activity+json',
                    href: 'https://example.com/actor',
                },
            ],
        };

        (
            lookupWebFinger as unknown as ReturnType<typeof vi.fn>
        ).mockResolvedValue(mockWebFingerResponse);

        const result = await lookupActorProfile(
            mockCtx as unknown as Context<ContextData>,
            'user@example.com',
        );

        expect(result).toEqual({
            profileUrl: null,
            apId: new URL('https://example.com/actor'),
        });
    });

    it('should handle handles with leading @', async () => {
        const mockWebFingerResponse = {
            links: [
                {
                    rel: 'http://webfinger.net/rel/profile-page',
                    href: 'https://example.com/profile',
                },
                {
                    rel: 'self',
                    type: 'application/activity+json',
                    href: 'https://example.com/actor',
                },
            ],
        };

        (
            lookupWebFinger as unknown as ReturnType<typeof vi.fn>
        ).mockResolvedValue(mockWebFingerResponse);

        const result = await lookupActorProfile(
            mockCtx as unknown as Context<ContextData>,
            '@user@example.com',
        );

        expect(lookupWebFinger).toHaveBeenCalledWith('acct:user@example.com', {
            allowPrivateAddress: true,
        });
        expect(result).toEqual({
            profileUrl: new URL('https://example.com/profile'),
            apId: new URL('https://example.com/actor'),
        });
    });

    it('should return null for both links when WebFinger response has no links', async () => {
        const mockWebFingerResponse = {};

        (
            lookupWebFinger as unknown as ReturnType<typeof vi.fn>
        ).mockResolvedValue(mockWebFingerResponse);

        const result = await lookupActorProfile(
            mockCtx as unknown as Context<ContextData>,
            'user@example.com',
        );

        expect(result).toEqual({ profileUrl: null, apId: null });
        expect(mockCtx.data.logger.info).toHaveBeenCalledWith(
            'No links found in WebFinger response for handle user@example.com',
        );
    });

    it('should return null for both links when no profile page or self link is found', async () => {
        const mockWebFingerResponse = {
            links: [
                {
                    rel: 'other',
                    href: 'https://example.com/other',
                },
            ],
        };

        (
            lookupWebFinger as unknown as ReturnType<typeof vi.fn>
        ).mockResolvedValue(mockWebFingerResponse);

        const result = await lookupActorProfile(
            mockCtx as unknown as Context<ContextData>,
            'user@example.com',
        );

        expect(result).toEqual({ profileUrl: null, apId: null });
        expect(mockCtx.data.logger.info).toHaveBeenCalledWith(
            'No valid ActivityPub links found in WebFinger response for handle user@example.com',
        );
    });

    it('should return null for both links when WebFinger lookup fails', async () => {
        (
            lookupWebFinger as unknown as ReturnType<typeof vi.fn>
        ).mockRejectedValue(new Error('WebFinger lookup failed'));

        const result = await lookupActorProfile(
            mockCtx as unknown as Context<ContextData>,
            'user@example.com',
        );

        expect(result).toEqual({ profileUrl: null, apId: null });
        expect(mockCtx.data.logger.error).toHaveBeenCalledWith(
            'Error looking up actor profile for handle user@example.com - Error: WebFinger lookup failed',
        );
    });

    it('should handle invalid URLs in both profile and self links', async () => {
        const mockWebFingerResponse = {
            links: [
                {
                    rel: 'http://webfinger.net/rel/profile-page',
                    href: 'not-a-valid-url',
                },
                {
                    rel: 'self',
                    type: 'application/activity+json',
                    href: 'also-not-valid',
                },
            ],
        };

        (
            lookupWebFinger as unknown as ReturnType<typeof vi.fn>
        ).mockResolvedValue(mockWebFingerResponse);

        const result = await lookupActorProfile(
            mockCtx as unknown as Context<ContextData>,
            'user@example.com',
        );

        expect(result).toEqual({ profileUrl: null, apId: null });
        expect(mockCtx.data.logger.info).toHaveBeenCalledWith(
            'Invalid profile page URL for handle user@example.com',
        );
        expect(mockCtx.data.logger.info).toHaveBeenCalledWith(
            'Invalid self link URL for handle user@example.com',
        );
    });

    it('should handle valid profile link but invalid self link', async () => {
        const mockWebFingerResponse = {
            links: [
                {
                    rel: 'http://webfinger.net/rel/profile-page',
                    href: 'https://example.com/profile',
                },
                {
                    rel: 'self',
                    type: 'application/activity+json',
                    href: 'not-a-valid-url',
                },
            ],
        };

        (
            lookupWebFinger as unknown as ReturnType<typeof vi.fn>
        ).mockResolvedValue(mockWebFingerResponse);

        const result = await lookupActorProfile(
            mockCtx as unknown as Context<ContextData>,
            'user@example.com',
        );

        expect(result).toEqual({
            profileUrl: new URL('https://example.com/profile'),
            apId: null,
        });
    });
});
