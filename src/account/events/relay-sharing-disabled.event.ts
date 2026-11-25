import type { SerializableEvent } from '@/events/event';

export class RelaySharingDisabledEvent implements SerializableEvent {
    constructor(private readonly accountId: number) {}

    static getName(): string {
        return 'account.relay-sharing.disabled';
    }

    getName(): string {
        return RelaySharingDisabledEvent.getName();
    }

    getAccountId(): number {
        return this.accountId;
    }

    toJSON(): Record<string, unknown> {
        return {
            accountId: this.accountId,
        };
    }

    static fromJSON(data: Record<string, unknown>): RelaySharingDisabledEvent {
        if (typeof data.accountId !== 'number') {
            throw new Error('accountId must be a number');
        }

        return new RelaySharingDisabledEvent(data.accountId);
    }
}
