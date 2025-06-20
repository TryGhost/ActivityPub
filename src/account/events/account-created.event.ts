export class AccountCreatedEvent {
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
}
