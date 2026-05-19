import type { SerializableEvent } from '@/events/event';

export class AccountAliasedEvent implements SerializableEvent {
    constructor(
        private readonly accountId: number,
        private readonly aliasApId: URL,
    ) {}

    static getName(): string {
        return 'account.aliased';
    }

    getName(): string {
        return AccountAliasedEvent.getName();
    }

    getAccountId(): number {
        return this.accountId;
    }

    getAliasApId(): URL {
        return this.aliasApId;
    }

    toJSON(): Record<string, unknown> {
        return {
            accountId: this.accountId,
            aliasApId: this.aliasApId.href,
        };
    }

    static fromJSON(data: Record<string, unknown>): AccountAliasedEvent {
        if (typeof data.accountId !== 'number') {
            throw new Error('accountId must be a number');
        }
        if (typeof data.aliasApId !== 'string') {
            throw new Error('aliasApId must be a string');
        }

        return new AccountAliasedEvent(data.accountId, new URL(data.aliasApId));
    }
}
