import type { SerializableEvent } from '@/events/event';

export class SiteDisablingEvent implements SerializableEvent {
    constructor(private readonly siteHost: string) {}

    static getName(): string {
        return 'site.disabling';
    }

    getName(): string {
        return SiteDisablingEvent.getName();
    }

    getSiteHost(): string {
        return this.siteHost;
    }

    toJSON(): Record<string, unknown> {
        return {
            siteHost: this.siteHost,
        };
    }

    static fromJSON(data: Record<string, unknown>): SiteDisablingEvent {
        if (typeof data.siteHost !== 'string') {
            throw new Error('siteHost must be a string');
        }
        return new SiteDisablingEvent(data.siteHost);
    }
}
