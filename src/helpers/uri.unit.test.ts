import { describe, expect, it } from 'vitest';

import { isUri, toURL } from './uri';

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
