export class AccountFollowedEvent {
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
}
