import type { SerializableEvent } from '@/events/event';

export class SiteCreatedEvent implements SerializableEvent {
    constructor(
        private readonly siteId: number,
        private readonly siteHost: string,
    ) {}

    static getName(): string {
        return 'site.created';
    }

    getName(): string {
        return SiteCreatedEvent.getName();
    }

    getSiteId(): number {
        return this.siteId;
    }

    getSiteHost(): string {
        return this.siteHost;
    }

    toJSON(): Record<string, unknown> {
        return {
            siteId: this.siteId,
            siteHost: this.siteHost,
        };
    }

    static fromJSON(data: Record<string, unknown>): SiteCreatedEvent {
        if (typeof data.siteId !== 'number') {
            throw new Error('siteId must be a number');
        }
        if (typeof data.siteHost !== 'string') {
            throw new Error('siteHost must be a string');
        }
        return new SiteCreatedEvent(data.siteId, data.siteHost);
    }
}
