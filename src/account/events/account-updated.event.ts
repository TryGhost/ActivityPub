import type { SerializableEvent } from '@/events/event';

export class AccountUpdatedEvent implements SerializableEvent {
    constructor(private readonly accountId: number) {}

    static getName(): string {
        return 'account.updated';
    }

    getName(): string {
        return AccountUpdatedEvent.getName();
    }

    getAccountId(): number {
        return this.accountId;
    }

    toJSON(): Record<string, unknown> {
        return {
            accountId: this.accountId,
        };
    }

    static fromJSON(data: Record<string, unknown>): AccountUpdatedEvent {
        if (typeof data.accountId !== 'number') {
            throw new Error('accountId must be a number');
        }

        return new AccountUpdatedEvent(data.accountId);
    }
}
