import type { Account } from 'account/account.entity';

export class AccountBlockedEvent {
    constructor(
        private readonly account: Account,
        private readonly blocker: Account,
    ) {}

    getAccount(): Account {
        return this.account;
    }

    getBlocker(): Account {
        return this.blocker;
    }

    static getName(): string {
        return 'account.blocked';
    }
}
