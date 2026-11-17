import { describe, expect, it } from 'vitest';

import { SiteDisablingEvent } from '@/site/site-disabling.event';

describe('SiteDisablingEvent', () => {
    it('returns the event name', () => {
        expect(SiteDisablingEvent.getName()).toBe('site.disabling');
        expect(new SiteDisablingEvent(1, 'example.com').getName()).toBe(
            'site.disabling',
        );
    });

    it('exposes the site id and host', () => {
        const event = new SiteDisablingEvent(42, 'example.com');
        expect(event.getSiteId()).toBe(42);
        expect(event.getSiteHost()).toBe('example.com');
    });

    it('serialises and deserialises', () => {
        const event = new SiteDisablingEvent(7, 'example.com');
        const restored = SiteDisablingEvent.fromJSON(event.toJSON());

        expect(restored.getSiteId()).toBe(7);
        expect(restored.getSiteHost()).toBe('example.com');
    });

    it('rejects invalid JSON', () => {
        expect(() => SiteDisablingEvent.fromJSON({})).toThrow(
            'siteId must be a number',
        );
        expect(() => SiteDisablingEvent.fromJSON({ siteId: 7 })).toThrow(
            'siteHost must be a string',
        );
    });
});
