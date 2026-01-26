import type { SerializableEvent } from '@/events/event';

export class AccountUnfollowedEvent implements SerializableEvent {
    constructor(
        private readonly accountId: number,
        private readonly unfollowerId: number,
    ) {}

    getAccountId(): number {
        return this.accountId;
    }

    getUnfollowerId(): number {
        return this.unfollowerId;
    }

    getName(): string {
        return 'account.unfollowed';
    }

    static getName(): string {
        return 'account.unfollowed';
    }

    toJSON(): Record<string, unknown> {
        return {
            accountId: this.accountId,
            unfollowerId: this.unfollowerId,
        };
    }

    static fromJSON(data: Record<string, unknown>): AccountUnfollowedEvent {
        if (typeof data.accountId !== 'number') {
            throw new Error('accountId must be a number');
        }
        if (typeof data.unfollowerId !== 'number') {
            throw new Error('unfollowerId must be a number');
        }

        return new AccountUnfollowedEvent(data.accountId, data.unfollowerId);
    }
}
