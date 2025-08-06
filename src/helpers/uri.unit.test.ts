import { describe, expect, it } from 'vitest';

import { isEqual, isUri, toURL } from '@/helpers/uri';

describe('isUri', () => {
    it('should return a boolean indicating if the provided string is a valid URI', () => {
        expect(isUri('https://example.com/user/foo')).toBe(true);
        expect(isUri('http://example.com/user/foo')).toBe(true);
        expect(isUri('://example.com/user/foo')).toBe(false);
        expect(isUri('http//example.com/user/foo')).toBe(false);
    });
});

describe('toURL', () => {
    it('should return a URL if the provided value is a valid URI', () => {
        expect(toURL('https://example.com/user/foo')).toBeInstanceOf(URL);
    });

    it('should return undefined if the provided value is not a string', () => {
        expect(toURL(123)).toBeUndefined();
        expect(toURL({})).toBeUndefined();
        expect(toURL([])).toBeUndefined();
        expect(toURL(null)).toBeUndefined();
        expect(toURL(undefined)).toBeUndefined();
    });

    it('should return undefined if the provided value is not a valid URI', () => {
        expect(toURL('://example.com/user/foo')).toBeUndefined();
    });
});

describe('isEqual', () => {
    it('should compare string URLs correctly', () => {
        expect(isEqual('https://example.com', 'https://example.com/')).toBe(
            true,
        );
        expect(isEqual('https://example.com', 'https://example.com')).toBe(
            true,
        );
        expect(isEqual('https://example.com/', 'https://example.com/')).toBe(
            true,
        );
        expect(isEqual('https://example.com', 'https://example.org')).toBe(
            false,
        );
    });

    it('should compare URL objects correctly', () => {
        const url1 = new URL('https://example.com');
        const url2 = new URL('https://example.com/');
        const url3 = new URL('https://example.org');

        expect(isEqual(url1, url1)).toBe(true);
        expect(isEqual(url1, url2)).toBe(true);
        expect(isEqual(url2, url3)).toBe(false);
        expect(isEqual(url1, url3)).toBe(false);
    });

    it('should compare mixed URL objects and strings correctly', () => {
        const url = new URL('https://example.com');

        expect(isEqual(url, 'https://example.com/')).toBe(true);
        expect(isEqual(url, 'https://example.org')).toBe(false);
    });

    it('should handle URLs with paths', () => {
        expect(
            isEqual('https://example.com/path', 'https://example.com/path/'),
        ).toBe(true);
        expect(
            isEqual(
                'https://example.com/path',
                'https://example.com/other-path',
            ),
        ).toBe(false);
    });
});
