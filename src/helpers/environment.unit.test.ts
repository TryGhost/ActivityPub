import { describe, expect, it } from 'vitest';

import { isLocalEnvironment } from './environment';

describe('isLocalEnvironment', () => {
    it('should return true for local environments', () => {
        expect(isLocalEnvironment('development')).toBe(true);
        expect(isLocalEnvironment('testing')).toBe(true);
    });

    it('should return false for deployed environments', () => {
        expect(isLocalEnvironment('staging')).toBe(false);
        expect(isLocalEnvironment('production')).toBe(false);
    });

    it('should return false when the environment is unset or unrecognised', () => {
        expect(isLocalEnvironment(undefined)).toBe(false);
        expect(isLocalEnvironment('')).toBe(false);
        expect(isLocalEnvironment('prod')).toBe(false);
    });
});
