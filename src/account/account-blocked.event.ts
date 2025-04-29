export class AccountBlockedEvent {
    constructor(
        private readonly accountId: number,
        private readonly blockerId: number,
    ) {}

    getAccountId(): number {
        return this.accountId;
    }

    getBlockerId(): number {
        return this.blockerId;
    }

    static getName(): string {
        return 'account.blocked';
    }
}
