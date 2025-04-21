import type { Account } from './account.entity';

export class AccountUpdatedEvent {
    static getName(): string {
        return 'account.updated';
    }

    constructor(private readonly account: Account) {}

    getAccount(): Account {
        return this.account;
    }
}
