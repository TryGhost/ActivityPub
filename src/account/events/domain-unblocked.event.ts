import type { SerializableEvent } from '@/events/event';

export class DomainUnblockedEvent implements SerializableEvent {
    constructor(
        private readonly domain: URL,
        private readonly unblockerId: number,
    ) {}

    getDomain(): URL {
        return this.domain;
    }

    getUnblockerId(): number {
        return this.unblockerId;
    }

    getName(): string {
        return 'domain.unblocked';
    }

    static getName(): string {
        return 'domain.unblocked';
    }

    toJSON(): Record<string, unknown> {
        return {
            domain: this.domain.toString(),
            unblockerId: this.unblockerId,
        };
    }

    static fromJSON(data: Record<string, unknown>): DomainUnblockedEvent {
        if (typeof data.domain !== 'string') {
            throw new Error('domain must be a string');
        }
        if (typeof data.unblockerId !== 'number') {
            throw new Error('unblockerId must be a number');
        }

        return new DomainUnblockedEvent(new URL(data.domain), data.unblockerId);
    }
}
