import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lookupWebFinger } from '@fedify/fedify';

import type { FedifyContext } from '@/app';
import { error, ok } from '@/core/result';
import { lookupActorProfile } from '@/lookup-helpers';

vi.mock('@fedify/fedify', () => ({
    lookupWebFinger: vi.fn(),
}));

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

        const result = await lookupActorProfile(
            mockCtx as unknown as FedifyContext,
            '@user@example.com',
        );

        expect(lookupWebFinger).toHaveBeenCalledWith('acct:user@example.com', {
            allowPrivateAddress: true,
        });
        expect(result).toEqual(ok(new URL('https://example.com/actor')));
    });

    it('should return no-links-found error when WebFinger response has no links', async () => {
        const mockWebFingerResponse = {
            links: null,
        };

        (
            lookupWebFinger as unknown as ReturnType<typeof vi.fn>
        ).mockResolvedValue(mockWebFingerResponse);

        const result = await lookupActorProfile(
            mockCtx as unknown as FedifyContext,
            'user@example.com',
        );

        expect(result).toEqual(error('no-links-found'));
    });

    it('should return no-self-link error when WebFinger response has no self link', async () => {
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

        const result = await lookupActorProfile(
            mockCtx as unknown as FedifyContext,
            'user@example.com',
        );

        expect(result).toEqual(error('no-self-link'));
    });

    it('should return lookup-error when WebFinger lookup fails', async () => {
        (
            lookupWebFinger as unknown as ReturnType<typeof vi.fn>
        ).mockRejectedValue(new Error('WebFinger lookup failed'));

        const result = await lookupActorProfile(
            mockCtx as unknown as FedifyContext,
            'user@example.com',
        );

        expect(result).toEqual(error('lookup-error'));
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

        const result = await lookupActorProfile(
            mockCtx as unknown as FedifyContext,
            'user@example.com',
        );

        expect(result).toEqual(ok(new URL('https://example.com/actor')));
    });
});
