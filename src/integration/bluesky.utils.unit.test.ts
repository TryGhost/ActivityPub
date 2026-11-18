import { describe, expect, it } from 'vitest';

import { getDomainHandleCandidates } from '@/integration/bluesky.utils';

function account(
    apId: string,
    webfingerHost: string | null = null,
    username = 'index',
) {
    return { apId: new URL(apId), webfingerHost, username };
}

describe('getDomainHandleCandidates', () => {
    it('uses the site host', () => {
        expect(
            getDomainHandleCandidates(
                account(
                    'https://blog.example.com/.ghost/activitypub/users/index',
                ),
            ),
        ).toEqual(['blog.example.com']);
    });

    it('prefers the root domain for a site on www', () => {
        expect(
            getDomainHandleCandidates(
                account(
                    'https://www.example.com/.ghost/activitypub/users/index',
                ),
            ),
        ).toEqual(['example.com', 'www.example.com']);
    });

    it('prefers a custom webfinger domain', () => {
        expect(
            getDomainHandleCandidates(
                account(
                    'https://blog.example.com/.ghost/activitypub/users/index',
                    'example.com',
                ),
            ),
        ).toEqual(['example.com', 'blog.example.com']);
    });

    it('lowercases the domains', () => {
        expect(
            getDomainHandleCandidates(
                account('https://Example.COM/.ghost/activitypub/users/index'),
            ),
        ).toEqual(['example.com']);
    });
});
