import type { SerializableEvent } from '@/events/event';

export class NotificationsReadEvent implements SerializableEvent {
    constructor(private readonly accountId: number) {}

    static getName(): string {
        return 'notifications.read';
    }

    getName(): string {
        return NotificationsReadEvent.getName();
    }

    getAccountId(): number {
        return this.accountId;
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
