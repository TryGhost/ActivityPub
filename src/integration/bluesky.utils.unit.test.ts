import { describe, expect, it } from 'vitest';

import {
    BRIDGY_FED_LABEL,
    findValidBridgyHandle,
} from '@/integration/bluesky.utils';
import type { Actor } from '@/integration/bluesky-api.client';

describe('findValidBridgyHandle', () => {
    const domain = 'example.com';
    const expectedHandle = '@test.example.com.ap.brid.gy';
    const bridgyLabel = { val: BRIDGY_FED_LABEL };

    describe('happy path', () => {
        it('should return a valid handle when found', () => {
            const actors: Actor[] = [
                {
                    handle: expectedHandle,
                    labels: [bridgyLabel],
                },
            ];

            const result = findValidBridgyHandle(actors, domain);

            expect(result).toBe(expectedHandle);
        });

        it('should find the correct handle among multiple actors', () => {
            const actors: Actor[] = [
                {
                    handle: 'other.bsky.social',
                    labels: [],
                },
                {
                    handle: expectedHandle,
                    labels: [bridgyLabel],
                },
                {
                    handle: 'another.example.com',
                    labels: [],
                },
            ];

            const result = findValidBridgyHandle(actors, domain);

            expect(result).toBe(expectedHandle);
        });
    });

    describe('no matching actors', () => {
        it('should return null when actors list is empty', () => {
            const actors: Actor[] = [];

            const result = findValidBridgyHandle(actors, domain);

            expect(result).toBeNull();
        });

        it('should return null when no actors have labels', () => {
            const actors: Actor[] = [
                {
                    handle: expectedHandle,
                },
                {
                    handle: 'other.bsky.social',
                },
            ];

            const result = findValidBridgyHandle(actors, domain);

            expect(result).toBeNull();
        });

        it('should return null when actors have wrong label', () => {
            const actors: Actor[] = [
                {
                    handle: expectedHandle,
                    labels: [{ val: 'some-other-label' }],
                },
            ];

            const result = findValidBridgyHandle(actors, domain);

            expect(result).toBeNull();
        });

        it('should return null when actor has correct label but wrong domain suffix', () => {
            const actors: Actor[] = [
                {
                    handle: '@test.different.com.ap.brid.gy',
                    labels: [bridgyLabel],
                },
            ];

            const result = findValidBridgyHandle(actors, domain);

            expect(result).toBeNull();
        });

        it('should return null when actor has correct domain suffix but no bridgy label', () => {
            const actors: Actor[] = [
                {
                    handle: expectedHandle,
                    labels: [{ val: 'some-other-label' }],
                },
            ];

            const result = findValidBridgyHandle(actors, domain);

            expect(result).toBeNull();
        });
    });

    describe('handle.invalid preference', () => {
        it('should return null when all matching actors have handle.invalid', () => {
            const actors: Actor[] = [
                {
                    handle: 'handle.invalid',
                    labels: [bridgyLabel],
                },
            ];

            const result = findValidBridgyHandle(actors, 'invalid.ap.brid.gy');

            expect(result).toBeNull();
        });

        it('should prefer non-handle.invalid over handle.invalid', () => {
            const actors: Actor[] = [
                {
                    handle: 'handle.invalid',
                    labels: [bridgyLabel],
                },
                {
                    handle: expectedHandle,
                    labels: [bridgyLabel],
                },
            ];

            const result = findValidBridgyHandle(actors, domain);

            expect(result).toBe(expectedHandle);
        });

        it('should prefer the first valid handle when multiple non-invalid handles exist', () => {
            const firstValidHandle = '@first.example.com.ap.brid.gy';
            const secondValidHandle = '@second.example.com.ap.brid.gy';

            const actors: Actor[] = [
                {
                    handle: 'handle.invalid',
                    labels: [bridgyLabel],
                },
                {
                    handle: firstValidHandle,
                    labels: [bridgyLabel],
                },
                {
                    handle: secondValidHandle,
                    labels: [bridgyLabel],
                },
            ];

            const result = findValidBridgyHandle(actors, domain);

            expect(result).toBe(firstValidHandle);
        });
    });

    describe('multiple matching actors', () => {
        it('should return the first matching actor when multiple valid ones exist', () => {
            const firstHandle = '@first.example.com.ap.brid.gy';
            const secondHandle = '@second.example.com.ap.brid.gy';

            const actors: Actor[] = [
                {
                    handle: firstHandle,
                    labels: [bridgyLabel],
                },
                {
                    handle: secondHandle,
                    labels: [bridgyLabel],
                },
            ];

            const result = findValidBridgyHandle(actors, domain);

            expect(result).toBe(firstHandle);
        });
    });

    describe('complex filtering scenarios', () => {
        it('should correctly filter through multiple criteria', () => {
            const actors: Actor[] = [
                // No labels
                {
                    handle: expectedHandle,
                },
                // Wrong label
                {
                    handle: expectedHandle,
                    labels: [{ val: 'wrong-label' }],
                },
                // Correct label, wrong domain
                {
                    handle: '@test.different.com.ap.brid.gy',
                    labels: [bridgyLabel],
                },
                // Correct label and domain, but handle.invalid
                {
                    handle: 'handle.invalid',
                    labels: [bridgyLabel],
                },
                // Correct everything!
                {
                    handle: expectedHandle,
                    labels: [bridgyLabel],
                },
            ];

            const result = findValidBridgyHandle(actors, domain);

            expect(result).toBe(expectedHandle);
        });

        it('should handle actors with multiple labels', () => {
            const actors: Actor[] = [
                {
                    handle: expectedHandle,
                    labels: [
                        { val: 'some-other-label' },
                        bridgyLabel,
                        { val: 'yet-another-label' },
                    ],
                },
            ];

            const result = findValidBridgyHandle(actors, domain);

            expect(result).toBe(expectedHandle);
        });
    });

    describe('www subdomain handling', () => {
        it('should find handle when domain has www prefix but Bridgy Fed strips it', () => {
            const wwwDomain = 'www.example.com';
            const handleWithoutWww = '@test.example.com.ap.brid.gy';

            const actors: Actor[] = [
                {
                    handle: handleWithoutWww,
                    labels: [bridgyLabel],
                },
            ];

            const result = findValidBridgyHandle(actors, wwwDomain);

            expect(result).toBe(handleWithoutWww);
        });

        it('should find handle when domain does not have www prefix', () => {
            const nonWwwDomain = 'example.com';
            const handleWithoutWww = '@test.example.com.ap.brid.gy';

            const actors: Actor[] = [
                {
                    handle: handleWithoutWww,
                    labels: [bridgyLabel],
                },
            ];

            const result = findValidBridgyHandle(actors, nonWwwDomain);

            expect(result).toBe(handleWithoutWww);
        });

        it('should handle edge case where www appears in subdomain after normalization', () => {
            const wwwDomain = 'www.example.com';
            const handleWithWww = '@test.www.example.com.ap.brid.gy';

            const actors: Actor[] = [
                {
                    handle: handleWithWww,
                    labels: [bridgyLabel],
                },
            ];

            const result = findValidBridgyHandle(actors, wwwDomain);

            expect(result).toBe(handleWithWww);
        });
    });
});
