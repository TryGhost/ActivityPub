import type { SerializableEvent } from '@/events/event';

export class AccountFollowedEvent implements SerializableEvent {
    constructor(
        private readonly accountId: number,
        private readonly followerId: number,
    ) {}

    getAccountId(): number {
        return this.accountId;
    }

    getFollowerId(): number {
        return this.followerId;
    }

    getName(): string {
        return 'account.followed';
    }

    static getName(): string {
        return 'account.followed';
    }

    toJSON(): Record<string, unknown> {
        return {
            accountId: this.accountId,
            followerId: this.followerId,
        };
    }

    static fromJSON(data: Record<string, unknown>): AccountFollowedEvent {
        if (typeof data.accountId !== 'number') {
            throw new Error('accountId must be a number');
        }
        if (typeof data.followerId !== 'number') {
            throw new Error('followerId must be a number');
        }

        return new AccountFollowedEvent(data.accountId, data.followerId);
    }
}
