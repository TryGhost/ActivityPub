import { describe, expect, it } from 'vitest';

import {
    getHashtagServiceHandle,
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

describe('getHashtagServiceHandle', () => {
    it('should return the handle of the hashtag account on the service', () => {
        expect(getHashtagServiceHandle('ghost', 'tags.pub')).toBe(
            '@ghost@tags.pub',
        );
        expect(getHashtagServiceHandle('web3', 'tags.pub')).toBe(
            '@web3@tags.pub',
        );
    });

    it('should return null for hashtags the service would fold into another', () => {
        expect(getHashtagServiceHandle('café', 'tags.pub')).toBeNull();
        expect(getHashtagServiceHandle('open_web', 'tags.pub')).toBeNull();
    });
});
