import type { SerializableEvent } from '@/events/event';

export class DomainBlockedEvent implements SerializableEvent {
    constructor(
        private readonly domain: URL,
        private readonly blockerId: number,
    ) {}

    getDomain(): URL {
        return this.domain;
    }

    getBlockerId(): number {
        return this.blockerId;
    }

    getName(): string {
        return 'domain.blocked';
    }

    static getName(): string {
        return 'domain.blocked';
    }

    toJSON(): Record<string, unknown> {
        return {
            domain: this.domain.toString(),
            blockerId: this.blockerId,
        };
    }

    static fromJSON(data: Record<string, unknown>): DomainBlockedEvent {
        if (typeof data.domain !== 'string') {
            throw new Error('domain must be a string');
        }
        if (typeof data.blockerId !== 'number') {
            throw new Error('blockerId must be a number');
        }

        return new DomainBlockedEvent(new URL(data.domain), data.blockerId);
    }
}
