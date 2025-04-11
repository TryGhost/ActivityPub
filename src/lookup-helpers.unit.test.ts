import { lookupWebFinger } from '@fedify/fedify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lookupAPIdByHandle } from './lookup-helpers';

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
            mockCtx as any,
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
            mockCtx as any,
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
            mockCtx as any,
            'user@example.com',
        );

        expect(result).toBeNull();
    });

    it('should return null when WebFinger lookup fails', async () => {
        (
            lookupWebFinger as unknown as ReturnType<typeof vi.fn>
        ).mockRejectedValue(new Error('WebFinger lookup failed'));

        const result = await lookupAPIdByHandle(
            mockCtx as any,
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
            mockCtx as any,
            'user@example.com',
        );

        expect(result).toBe('https://example.com/actor');
    });
});
