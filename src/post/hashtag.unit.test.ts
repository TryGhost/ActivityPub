import { describe, expect, it } from 'vitest';

import {
    getHashtagLinksFromGhostTags,
    getHashtagNameFromGhostTag,
    getHashtagUrl,
    normalizeHashtag,
    normalizeHashtags,
} from '@/post/hashtag';

describe('normalizeHashtag', () => {
    it('should strip the leading # and lowercase the name', () => {
        expect(normalizeHashtag('#GhostCMS')).toBe('ghostcms');
        expect(normalizeHashtag('GhostCMS')).toBe('ghostcms');
    });

    it('should apply unicode normalization', () => {
        // Decomposed "é" and fullwidth letters
        expect(normalizeHashtag('#cafe\u0301')).toBe('café');
        expect(normalizeHashtag('#ＧＨＯＳＴ')).toBe('ghost');
    });

    it('should accept letters, numbers and underscores', () => {
        expect(normalizeHashtag('#web_3')).toBe('web_3');
        expect(normalizeHashtag('#日本語')).toBe('日本語');
    });

    it('should reject names that are not valid hashtags', () => {
        expect(normalizeHashtag('')).toBeNull();
        expect(normalizeHashtag('#')).toBeNull();
        expect(normalizeHashtag('#2024')).toBeNull();
        expect(normalizeHashtag('#_')).toBeNull();
        expect(normalizeHashtag('#two words')).toBeNull();
        expect(normalizeHashtag('#with-dash')).toBeNull();
        expect(normalizeHashtag(`#${'a'.repeat(256)}`)).toBeNull();
    });

    it('should accept names up to 255 characters', () => {
        expect(normalizeHashtag(`#${'a'.repeat(255)}`)).toBe('a'.repeat(255));
    });
});

describe('normalizeHashtags', () => {
    it('should normalize, deduplicate and drop invalid names', () => {
        expect(
            normalizeHashtags(['#Ghost', 'ghost', '#GHOST', '#2024', '#News']),
        ).toEqual(['ghost', 'news']);
    });
});

describe('getHashtagNameFromGhostTag', () => {
    it('should keep single word names as they are', () => {
        expect(getHashtagNameFromGhostTag('iOS')).toBe('iOS');
    });

    it('should join multi-word names in CamelCase', () => {
        expect(getHashtagNameFromGhostTag('Getting Started')).toBe(
            'GettingStarted',
        );
        expect(getHashtagNameFromGhostTag('web development')).toBe(
            'WebDevelopment',
        );
        expect(getHashtagNameFromGhostTag('Self-hosting & DevOps')).toBe(
            'SelfHostingDevOps',
        );
    });

    it('should return null for names without letters', () => {
        expect(getHashtagNameFromGhostTag('2024')).toBeNull();
        expect(getHashtagNameFromGhostTag('---')).toBeNull();
    });
});

describe('getHashtagLinksFromGhostTags', () => {
    it('should convert Ghost tags into hashtag links', () => {
        expect(
            getHashtagLinksFromGhostTags([
                {
                    name: 'Getting Started',
                    url: 'https://example.com/tag/getting-started/',
                },
                { name: 'News', url: 'https://example.com/tag/news/' },
            ]),
        ).toEqual([
            {
                name: 'GettingStarted',
                href: new URL('https://example.com/tag/getting-started/'),
            },
            { name: 'News', href: new URL('https://example.com/tag/news/') },
        ]);
    });

    it('should skip tags without a valid hashtag name or URL', () => {
        expect(
            getHashtagLinksFromGhostTags([
                { name: '2024', url: 'https://example.com/tag/2024/' },
                { name: 'News', url: 'not a url' },
            ]),
        ).toEqual([]);
    });

    it('should skip tags that produce the same hashtag', () => {
        expect(
            getHashtagLinksFromGhostTags([
                { name: 'Web Dev', url: 'https://example.com/tag/web-dev/' },
                { name: 'webdev', url: 'https://example.com/tag/webdev/' },
            ]),
        ).toEqual([
            {
                name: 'WebDev',
                href: new URL('https://example.com/tag/web-dev/'),
            },
        ]);
    });
});

describe('getHashtagUrl', () => {
    it('should return the tag archive URL for the hashtag', () => {
        expect(
            getHashtagUrl(new URL('https://example.com'), 'GhostCMS').href,
        ).toBe('https://example.com/tag/ghostcms/');
        expect(
            getHashtagUrl(new URL('https://example.com/blog/'), 'café').href,
        ).toBe('https://example.com/blog/tag/caf%C3%A9/');
    });
});
