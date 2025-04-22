import type { Account } from 'account/account.entity';

export class AccountBlockedEvent {
    constructor(
        private readonly actor: Account,
        private readonly blocked: Account,
    ) {}

    getActor(): Account {
        return this.actor;
    }

    getBlocked(): Account {
        return this.blocked;
    }

    static getName(): string {
        return 'account.blocked';
    }
}
