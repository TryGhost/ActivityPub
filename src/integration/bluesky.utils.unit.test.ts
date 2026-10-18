import { describe, expect, it } from 'vitest';

import {
    getDefaultBridgyHandle,
    getDomainHandleCandidates,
} from '@/integration/bluesky.utils';

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

describe('getDefaultBridgyHandle', () => {
    it('builds the handle from the username and handle domain', () => {
        expect(
            getDefaultBridgyHandle(
                account(
                    'https://www.example.com/.ghost/activitypub/users/index',
                ),
            ),
        ).toBe('index.example.com.ap.brid.gy');
    });

    it('uses a custom webfinger domain', () => {
        expect(
            getDefaultBridgyHandle(
                account(
                    'https://blog.example.com/.ghost/activitypub/users/index',
                    'example.com',
                    'murat',
                ),
            ),
        ).toBe('murat.example.com.ap.brid.gy');
    });

    it('replaces underscores and tildes with dashes', () => {
        expect(
            getDefaultBridgyHandle(
                account(
                    'https://example.com/.ghost/activitypub/users/index',
                    null,
                    'a_b~c',
                ),
            ),
        ).toBe('a-b-c.example.com.ap.brid.gy');
    });
});
