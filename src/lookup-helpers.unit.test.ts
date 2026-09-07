import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lookupWebFinger } from '@fedify/webfinger';

import type { FedifyContext } from '@/app';
import { error, ok } from '@/core/result';
import {
    lookupActorProfile,
    resolveCustomWebfingerHost,
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
            signal: expect.any(AbortSignal),
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

describe('resolveCustomWebfingerHost', () => {
    const ACTOR_ID = 'https://john.onolan.org/.ghost/activitypub/users/index';

    const webfingerMock = () =>
        lookupWebFinger as unknown as ReturnType<typeof vi.fn>;

    function jrd(subject: string, selfHref = ACTOR_ID) {
        return {
            subject,
            links: [
                {
                    rel: 'self',
                    type: 'application/activity+json',
                    href: selfHref,
                },
            ],
        };
    }

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns the custom host when the claimed domain confirms the actor', async () => {
        webfingerMock()
            .mockResolvedValueOnce(jrd('acct:john@onolan.org'))
            .mockResolvedValueOnce(jrd('acct:john@onolan.org'));

        const result = await resolveCustomWebfingerHost(
            'john',
            new URL(ACTOR_ID),
        );

        expect(webfingerMock()).toHaveBeenNthCalledWith(
            1,
            'acct:john@john.onolan.org',
            expect.any(Object),
        );
        expect(webfingerMock()).toHaveBeenNthCalledWith(
            2,
            'acct:john@onolan.org',
            expect.any(Object),
        );
        expect(result).toEqual({ type: 'custom', host: 'onolan.org' });
    });

    it('rejects a custom host the claimed domain does not vouch for', async () => {
        const attackerId = 'https://evil.example/users/index';

        webfingerMock()
            // The attacker's own server claims a handle on a domain it does not run
            .mockResolvedValueOnce(
                jrd('acct:index@victim-site.com', attackerId),
            )
            // The real victim-site.com answers with its own actor
            .mockResolvedValueOnce(
                jrd(
                    'acct:index@victim-site.com',
                    'https://victim-site.com/.ghost/activitypub/users/index',
                ),
            );

        const result = await resolveCustomWebfingerHost(
            'index',
            new URL(attackerId),
        );

        expect(result).toEqual({ type: 'none' });
    });

    it('reports unavailable when the confirming lookup fails, so a stored host is kept', async () => {
        webfingerMock()
            .mockResolvedValueOnce(jrd('acct:john@onolan.org'))
            .mockRejectedValueOnce(new Error('network'));

        const result = await resolveCustomWebfingerHost(
            'john',
            new URL(ACTOR_ID),
        );

        expect(result).toEqual({ type: 'unavailable' });
    });

    it('returns none when the subject host matches the actor host', async () => {
        webfingerMock().mockResolvedValue(
            jrd('acct:alice@example.com', 'https://example.com/users/alice'),
        );

        const result = await resolveCustomWebfingerHost(
            'alice',
            new URL('https://example.com/users/alice'),
        );

        expect(result).toEqual({ type: 'none' });
        expect(webfingerMock()).toHaveBeenCalledTimes(1);
    });

    it('returns none when the self link does not match the actor', async () => {
        webfingerMock().mockResolvedValue(
            jrd('acct:alice@custom.example', 'https://example.com/users/other'),
        );

        const result = await resolveCustomWebfingerHost(
            'alice',
            new URL('https://example.com/users/alice'),
        );

        expect(result).toEqual({ type: 'none' });
    });

    it('treats trailing-slash differences on the self link as the same actor', async () => {
        webfingerMock()
            .mockResolvedValueOnce(
                jrd(
                    'acct:alice@custom.example',
                    'https://example.com/users/alice/',
                ),
            )
            .mockResolvedValueOnce(
                jrd(
                    'acct:alice@custom.example',
                    'https://example.com/users/alice',
                ),
            );

        const result = await resolveCustomWebfingerHost(
            'alice',
            new URL('https://example.com/users/alice'),
        );

        expect(result).toEqual({ type: 'custom', host: 'custom.example' });
    });

    it('accepts an uppercase acct scheme', async () => {
        webfingerMock()
            .mockResolvedValueOnce(jrd('ACCT:john@onolan.org'))
            .mockResolvedValueOnce(jrd('ACCT:john@onolan.org'));

        const result = await resolveCustomWebfingerHost(
            'john',
            new URL(ACTOR_ID),
        );

        expect(result).toEqual({ type: 'custom', host: 'onolan.org' });
    });

    it('passes a timeout signal to every lookup', async () => {
        webfingerMock().mockResolvedValue(
            jrd('acct:alice@example.com', 'https://example.com/users/alice'),
        );

        await resolveCustomWebfingerHost(
            'alice',
            new URL('https://example.com/users/alice'),
        );

        expect(webfingerMock()).toHaveBeenCalledWith(
            'acct:alice@example.com',
            expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
    });

    it('returns unavailable when the first WebFinger lookup fails', async () => {
        webfingerMock().mockRejectedValue(new Error('network'));

        const result = await resolveCustomWebfingerHost(
            'alice',
            new URL('https://example.com/users/alice'),
        );

        expect(result).toEqual({ type: 'unavailable' });
    });
});
