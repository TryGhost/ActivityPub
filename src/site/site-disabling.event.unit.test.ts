import { describe, expect, it } from 'vitest';

import { SiteDisablingEvent } from '@/site/site-disabling.event';

describe('SiteDisablingEvent', () => {
    it('returns the event name', () => {
        expect(SiteDisablingEvent.getName()).toBe('site.disabling');
        expect(new SiteDisablingEvent('example.com').getName()).toBe(
            'site.disabling',
        );
    });

    it('exposes the site host', () => {
        const event = new SiteDisablingEvent('example.com');
        expect(event.getSiteHost()).toBe('example.com');
    });

    it('serialises and deserialises', () => {
        const event = new SiteDisablingEvent('example.com');
        expect(event.toJSON()).toEqual({ siteHost: 'example.com' });
        const restored = SiteDisablingEvent.fromJSON(event.toJSON());

        expect(restored.getSiteHost()).toBe('example.com');
    });

    it('rejects invalid JSON', () => {
        expect(() => SiteDisablingEvent.fromJSON({})).toThrow(
            'siteHost must be a string',
        );
        expect(() => SiteDisablingEvent.fromJSON({ siteHost: 7 })).toThrow(
            'siteHost must be a string',
        );
    });
});
