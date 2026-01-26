import type { SerializableEvent } from '@/events/event';

export class NotificationsReadEvent implements SerializableEvent {
    constructor(private readonly accountId: number) {}

    getAccountId(): number {
        return this.accountId;
    }

    getName(): string {
        return 'notifications.read';
    }

    static getName(): string {
        return 'notifications.read';
    }

    toJSON(): Record<string, unknown> {
        return {
            accountId: this.accountId,
        };
    }

    static fromJSON(data: Record<string, unknown>): NotificationsReadEvent {
        if (typeof data.accountId !== 'number') {
            throw new Error('accountId must be a number');
        }

        return new NotificationsReadEvent(data.accountId);
    }
}
