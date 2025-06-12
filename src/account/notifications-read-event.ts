export class NotificationReadEvent {
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
}
