import { describe, expect, it } from 'vitest';

import { isUri } from './uri';

describe('isUri', () => {
    it('should return a boolean indicating if the provided string is a valid URI', () => {
        expect(isUri('https://example.com/user/foo')).toBe(true);
        expect(isUri('http://example.com/user/foo')).toBe(true);
        expect(isUri('://example.com/user/foo')).toBe(false);
        expect(isUri('http//example.com/user/foo')).toBe(false);
    });
});
