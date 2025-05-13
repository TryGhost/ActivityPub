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

    it('should return profile page URL when available', async () => {
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
        expect(result).toEqual(new URL('https://example.com/profile'));
    });

    it('should fallback to self link when profile page is not available', async () => {
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

        expect(result).toEqual(new URL('https://example.com/actor'));
    });

    it('should handle handles with leading @', async () => {
        const mockWebFingerResponse = {
            links: [
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
            '@user@example.com',
        );

        expect(lookupWebFinger).toHaveBeenCalledWith('acct:user@example.com', {
            allowPrivateAddress: true,
        });
        expect(result).toEqual(new URL('https://example.com/profile'));
    });

    it('should return null when WebFinger response has no links', async () => {
        const mockWebFingerResponse = {};

        (
            lookupWebFinger as unknown as ReturnType<typeof vi.fn>
        ).mockResolvedValue(mockWebFingerResponse);

        const result = await lookupActorProfile(
            mockCtx as unknown as Context<ContextData>,
            'user@example.com',
        );

        expect(result).toBeNull();
        expect(mockCtx.data.logger.info).toHaveBeenCalledWith(
            'No links found in WebFinger response for handle user@example.com',
        );
    });

    it('should return null when no profile page or self link is found', async () => {
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

        expect(result).toBeNull();
        expect(mockCtx.data.logger.info).toHaveBeenCalledWith(
            'No ActivityPub profile found in WebFinger response for handle user@example.com',
        );
    });

    it('should return null when WebFinger lookup fails', async () => {
        (
            lookupWebFinger as unknown as ReturnType<typeof vi.fn>
        ).mockRejectedValue(new Error('WebFinger lookup failed'));

        const result = await lookupActorProfile(
            mockCtx as unknown as Context<ContextData>,
            'user@example.com',
        );

        expect(result).toBeNull();
        expect(mockCtx.data.logger.error).toHaveBeenCalledWith(
            'Error looking up actor profile for handle user@example.com - Error: WebFinger lookup failed',
        );
    });

    it('should return null when self link href is not a valid URL', async () => {
        const mockWebFingerResponse = {
            links: [
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

        expect(result).toBeNull();
        expect(mockCtx.data.logger.error).toHaveBeenCalledWith(
            'Error looking up actor profile for handle user@example.com - TypeError: Invalid URL',
        );
    });

    it('should fall back to self link when profile link href is not a valid URL', async () => {
        const mockWebFingerResponse = {
            links: [
                {
                    rel: 'http://webfinger.net/rel/profile-page',
                    href: 'not-a-valid-url',
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
            'user@example.com',
        );

        expect(result).toEqual(new URL('https://example.com/actor'));
    });
});
