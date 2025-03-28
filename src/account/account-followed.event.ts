import type { Account } from './account.entity';

export class AccountFollowedEvent {
    constructor(
        private readonly account: Account,
        private readonly follower: Account,
    ) {}

    getAccount(): Account {
        return this.account;
    }

    getFollower(): Account {
        return this.follower;
    }

    static getName(): string {
        return 'account.followed';
    }
}
