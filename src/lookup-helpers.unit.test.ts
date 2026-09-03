import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lookupWebFinger } from '@fedify/webfinger';

import type { FedifyContext } from '@/app';
import { error, ok } from '@/core/result';
import {
    lookupActorProfile,
    resolveExternalWebfingerHost,
} from '@/lookup-helpers';

vi.mock('@fedify/webfinger', () => ({
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
            allowPrivateAddress: expect.any(Boolean),
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

describe('resolveExternalWebfingerHost', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns custom when the WebFinger subject host differs from the actor host', async () => {
        (
            lookupWebFinger as unknown as ReturnType<typeof vi.fn>
        ).mockResolvedValue({
            subject: 'acct:john@onolan.org',
            links: [
                {
                    rel: 'self',
                    type: 'application/activity+json',
                    href: 'https://john.onolan.org/.ghost/activitypub/users/index',
                },
            ],
        });

        const result = await resolveExternalWebfingerHost(
            'john',
            new URL('https://john.onolan.org/.ghost/activitypub/users/index'),
        );

        expect(lookupWebFinger).toHaveBeenCalledWith(
            'acct:john@john.onolan.org',
            expect.any(Object),
        );
        expect(result).toEqual({ type: 'custom', host: 'onolan.org' });
    });

    it('returns default when the subject host matches the actor host', async () => {
        (
            lookupWebFinger as unknown as ReturnType<typeof vi.fn>
        ).mockResolvedValue({
            subject: 'acct:alice@example.com',
            links: [
                {
                    rel: 'self',
                    type: 'application/activity+json',
                    href: 'https://example.com/users/alice',
                },
            ],
        });

        const result = await resolveExternalWebfingerHost(
            'alice',
            new URL('https://example.com/users/alice'),
        );

        expect(result).toEqual({ type: 'default' });
    });

    it('returns unavailable when the self link does not match the actor', async () => {
        (
            lookupWebFinger as unknown as ReturnType<typeof vi.fn>
        ).mockResolvedValue({
            subject: 'acct:alice@custom.example',
            links: [
                {
                    rel: 'self',
                    type: 'application/activity+json',
                    href: 'https://example.com/users/other',
                },
            ],
        });

        const result = await resolveExternalWebfingerHost(
            'alice',
            new URL('https://example.com/users/alice'),
        );

        expect(result).toEqual({ type: 'unavailable' });
    });

    it('treats trailing-slash differences on the self link as the same actor', async () => {
        (
            lookupWebFinger as unknown as ReturnType<typeof vi.fn>
        ).mockResolvedValue({
            subject: 'acct:alice@custom.example',
            links: [
                {
                    rel: 'self',
                    type: 'application/activity+json',
                    href: 'https://example.com/users/alice/',
                },
            ],
        });

        const result = await resolveExternalWebfingerHost(
            'alice',
            new URL('https://example.com/users/alice'),
        );

        expect(result).toEqual({ type: 'custom', host: 'custom.example' });
    });

    it('returns unavailable when WebFinger lookup fails', async () => {
        (
            lookupWebFinger as unknown as ReturnType<typeof vi.fn>
        ).mockRejectedValue(new Error('network'));

        const result = await resolveExternalWebfingerHost(
            'alice',
            new URL('https://example.com/users/alice'),
        );

        expect(result).toEqual({ type: 'unavailable' });
    });
});
