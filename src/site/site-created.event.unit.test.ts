import { describe, expect, it } from 'vitest';

import { SiteCreatedEvent } from '@/site/site-created.event';

describe('SiteCreatedEvent', () => {
    it('returns the event name', () => {
        expect(SiteCreatedEvent.getName()).toBe('site.created');
        expect(new SiteCreatedEvent(1, 'example.com').getName()).toBe(
            'site.created',
        );
    });

    it('exposes the site id and host', () => {
        const event = new SiteCreatedEvent(42, 'example.com');
        expect(event.getSiteId()).toBe(42);
        expect(event.getSiteHost()).toBe('example.com');
    });

    it('serialises and deserialises', () => {
        const event = new SiteCreatedEvent(7, 'example.com');
        const restored = SiteCreatedEvent.fromJSON(event.toJSON());

        expect(restored.getSiteId()).toBe(7);
        expect(restored.getSiteHost()).toBe('example.com');
    });

    it('rejects invalid JSON', () => {
        expect(() => SiteCreatedEvent.fromJSON({})).toThrow(
            'siteId must be a number',
        );
        expect(() => SiteCreatedEvent.fromJSON({ siteId: 7 })).toThrow(
            'siteHost must be a string',
        );
    });
});
