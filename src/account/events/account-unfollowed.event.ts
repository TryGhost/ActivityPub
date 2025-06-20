export class AccountUnfollowedEvent {
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
}
