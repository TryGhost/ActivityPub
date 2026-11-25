import { describe, expect, it } from 'vitest';

import { SiteCreatedEvent } from '@/site/site-created.event';

describe('SiteCreatedEvent', () => {
    it('returns the event name', () => {
        expect(SiteCreatedEvent.getName()).toBe('site.created');
        expect(new SiteCreatedEvent('example.com').getName()).toBe(
            'site.created',
        );
    });

    it('exposes the site host', () => {
        const event = new SiteCreatedEvent('example.com');
        expect(event.getSiteHost()).toBe('example.com');
    });

    it('serialises and deserialises', () => {
        const event = new SiteCreatedEvent('example.com');
        expect(event.toJSON()).toEqual({ siteHost: 'example.com' });
        const restored = SiteCreatedEvent.fromJSON(event.toJSON());

        expect(restored.getSiteHost()).toBe('example.com');
    });

    it('rejects invalid JSON', () => {
        expect(() => SiteCreatedEvent.fromJSON({})).toThrow(
            'siteHost must be a string',
        );
        expect(() => SiteCreatedEvent.fromJSON({ siteHost: 7 })).toThrow(
            'siteHost must be a string',
        );
    });
});
