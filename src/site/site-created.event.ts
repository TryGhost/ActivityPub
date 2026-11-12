import type { SerializableEvent } from '@/events/event';

export class SiteCreatedEvent implements SerializableEvent {
    constructor(private readonly siteId: number) {}

    static getName(): string {
        return 'site.created';
    }

    getName(): string {
        return SiteCreatedEvent.getName();
    }

    getSiteId(): number {
        return this.siteId;
    }

    toJSON(): Record<string, unknown> {
        return {
            siteId: this.siteId,
        };
    }

    static fromJSON(data: Record<string, unknown>): SiteCreatedEvent {
        if (typeof data.siteId !== 'number') {
            throw new Error('siteId must be a number');
        }
        return new SiteCreatedEvent(data.siteId);
    }
}
