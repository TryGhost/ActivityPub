import type { SerializableEvent } from '@/events/event';

export class AccountUnblockedEvent implements SerializableEvent {
    constructor(
        private readonly accountId: number,
        private readonly unblockerId: number,
    ) {}

    static getName(): string {
        return 'account.unblocked';
    }

    getName(): string {
        return AccountUnblockedEvent.getName();
    }

    getAccountId(): number {
        return this.accountId;
    }

    getUnblockerId(): number {
        return this.unblockerId;
    }

    toJSON(): Record<string, unknown> {
        return {
            accountId: this.accountId,
            unblockerId: this.unblockerId,
        };
    }

    static fromJSON(data: Record<string, unknown>): AccountUnblockedEvent {
        if (typeof data.accountId !== 'number') {
            throw new Error('accountId must be a number');
        }
        if (typeof data.unblockerId !== 'number') {
            throw new Error('unblockerId must be a number');
        }

        return new AccountUnblockedEvent(data.accountId, data.unblockerId);
    }
}
