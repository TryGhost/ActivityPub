import type { SerializableEvent } from '@/events/event';

export class SiteCreatedEvent implements SerializableEvent {
    constructor(private readonly siteHost: string) {}

    static getName(): string {
        return 'site.created';
    }

    getName(): string {
        return SiteCreatedEvent.getName();
    }

    getSiteHost(): string {
        return this.siteHost;
    }

    toJSON(): Record<string, unknown> {
        return {
            siteHost: this.siteHost,
        };
    }

    static fromJSON(data: Record<string, unknown>): SiteCreatedEvent {
        if (typeof data.siteHost !== 'string') {
            throw new Error('siteHost must be a string');
        }
        return new SiteCreatedEvent(data.siteHost);
    }
}
