export class AccountUnblockedEvent {
    constructor(
        private readonly accountId: number,
        private readonly unblockerId: number,
    ) {}

    getAccountId(): number {
        return this.accountId;
    }

    getUnblockerId(): number {
        return this.unblockerId;
    }

    getName(): string {
        return 'account.unblocked';
    }

    static getName(): string {
        return 'account.unblocked';
    }
}
