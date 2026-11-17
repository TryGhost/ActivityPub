import type { SerializableEvent } from '@/events/event';

export class SiteDisablingEvent implements SerializableEvent {
    constructor(
        private readonly siteId: number,
        private readonly siteHost: string,
    ) {}

    static getName(): string {
        return 'site.disabling';
    }

    getName(): string {
        return SiteDisablingEvent.getName();
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

    static fromJSON(data: Record<string, unknown>): SiteDisablingEvent {
        if (typeof data.siteId !== 'number') {
            throw new Error('siteId must be a number');
        }
        if (typeof data.siteHost !== 'string') {
            throw new Error('siteHost must be a string');
        }
        return new SiteDisablingEvent(data.siteId, data.siteHost);
    }
}
