import { describe, expect, it } from 'vitest';

import { SiteCreatedEvent } from '@/site/site-created.event';

describe('SiteCreatedEvent', () => {
    it('returns the event name', () => {
        expect(SiteCreatedEvent.getName()).toBe('site.created');
        expect(new SiteCreatedEvent(1).getName()).toBe('site.created');
    });

    it('exposes the site id', () => {
        expect(new SiteCreatedEvent(42).getSiteId()).toBe(42);
    });

    it('serialises and deserialises', () => {
        const event = new SiteCreatedEvent(7);
        const restored = SiteCreatedEvent.fromJSON(event.toJSON());

        expect(restored.getSiteId()).toBe(7);
    });

    it('rejects invalid JSON', () => {
        expect(() => SiteCreatedEvent.fromJSON({})).toThrow(
            'siteId must be a number',
        );
    });
});
