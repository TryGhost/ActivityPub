import type { SerializableEvent } from '@/events/event';

export class RelaySharingEnabledEvent implements SerializableEvent {
    constructor(private readonly accountId: number) {}

    static getName(): string {
        return 'account.relay-sharing.enabled';
    }

    getName(): string {
        return RelaySharingEnabledEvent.getName();
    }

    getAccountId(): number {
        return this.accountId;
    }

    toJSON(): Record<string, unknown> {
        return {
            accountId: this.accountId,
        };
    }

    static fromJSON(data: Record<string, unknown>): RelaySharingEnabledEvent {
        if (typeof data.accountId !== 'number') {
            throw new Error('accountId must be a number');
        }

        return new RelaySharingEnabledEvent(data.accountId);
    }
}
