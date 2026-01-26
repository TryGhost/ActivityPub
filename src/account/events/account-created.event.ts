import type { SerializableEvent } from '@/events/event';

export class AccountCreatedEvent implements SerializableEvent {
    constructor(private readonly accountId: number) {}

    getAccountId(): number {
        return this.accountId;
    }

    getName(): string {
        return 'account.created';
    }

    static getName(): string {
        return 'account.created';
    }

    toJSON(): Record<string, unknown> {
        return {
            accountId: this.accountId,
        };
    }

    static fromJSON(data: Record<string, unknown>): AccountCreatedEvent {
        if (typeof data.accountId !== 'number') {
            throw new Error('accountId must be a number');
        }

        return new AccountCreatedEvent(data.accountId);
    }
}
