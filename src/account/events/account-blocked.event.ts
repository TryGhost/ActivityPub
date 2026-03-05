import type { SerializableEvent } from '@/events/event';

export class AccountBlockedEvent implements SerializableEvent {
    constructor(
        private readonly accountId: number,
        private readonly blockerId: number,
    ) {}

    static getName(): string {
        return 'account.blocked';
    }

    getName(): string {
        return AccountBlockedEvent.getName();
    }

    getAccountId(): number {
        return this.accountId;
    }

    getBlockerId(): number {
        return this.blockerId;
    }

    toJSON(): Record<string, unknown> {
        return {
            accountId: this.accountId,
            blockerId: this.blockerId,
        };
    }

    static fromJSON(data: Record<string, unknown>): AccountBlockedEvent {
        if (typeof data.accountId !== 'number') {
            throw new Error('accountId must be a number');
        }
        if (typeof data.blockerId !== 'number') {
            throw new Error('blockerId must be a number');
        }

        return new AccountBlockedEvent(data.accountId, data.blockerId);
    }
}
