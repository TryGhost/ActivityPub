import { describe, expect, it } from 'vitest';
import { FlagService } from './flag.service';

describe('FlagService', () => {
    it('should be able to register flags', () => {
        const flagService = new FlagService(['foo', 'bar']);

        expect(flagService.getRegistered()).toEqual(['foo', 'bar']);
    });

    it('should be able to enable a flag', () => {
        const flagService = new FlagService(['foo', 'bar']);

        flagService.runInContext(async () => {
            flagService.enable('foo');

            expect(flagService.isEnabled('foo')).toBe(true);
            expect(flagService.isEnabled('bar')).toBe(false);
        });
    });

    it('should be able to enable multiple flags', () => {
        const flagService = new FlagService(['foo', 'bar']);

        flagService.runInContext(async () => {
            flagService.enable('foo');
            flagService.enable('bar');

            expect(flagService.isEnabled('foo')).toBe(true);
            expect(flagService.isEnabled('bar')).toBe(true);
        });
    });

    it('should ignore unregistered flags', () => {
        const flagService = new FlagService(['foo']);

        flagService.runInContext(async () => {
            flagService.enable('bar');

            expect(flagService.isEnabled('bar')).toBe(false);
        });
    });

    it('should isolate flags between different contexts', async () => {
        const flagService = new FlagService(['foo', 'bar']);

        flagService.runInContext(async () => {
            flagService.enable('foo');

            expect(flagService.isEnabled('foo')).toBe(true);
            expect(flagService.isEnabled('bar')).toBe(false);
        });

        flagService.runInContext(async () => {
            flagService.enable('bar');

            expect(flagService.isEnabled('foo')).toBe(false);
            expect(flagService.isEnabled('bar')).toBe(true);
        });
    });
});
