import type { Logger } from '@logtape/logtape';
import type { KnexAccountRepository } from 'account/account.repository.knex';
import type { AccountService } from 'account/account.service';
import { AccountCreatedEvent } from 'account/events';
import type { AsyncEvents } from 'core/events';

export class GhostExploreService {
    constructor(
        private readonly events: AsyncEvents,
        private readonly accountRepository: KnexAccountRepository,
        private readonly accountService: AccountService,
        private readonly logger: Logger,
    ) {}

    init() {
        this.events.on(
            AccountCreatedEvent.getName(),
            async (event: AccountCreatedEvent) => {
                try {
                    await this.followGhostExplore(event.getAccountId());
                } catch (error) {
                    this.logger.error(
                        'Failed to follow Ghost Explore account for {accountId}',
                        {
                            accountId: event.getAccountId(),
                            error,
                        },
                    );
                }
            },
        );
    }

    async followGhostExplore(accountId: number) {
        const account = await this.accountRepository.getById(accountId);

        if (!account) {
            this.logger.error(
                'Could not find account {id} for account created event',
                {
                    id: accountId,
                },
            );
            return;
        }

        if (!account.isInternal) {
            this.logger.debug(
                'Not following Ghost Explore account for non-internal account {apId}',
                {
                    apId: account?.apId.href,
                },
            );
            return;
        }

        const ghostExplore = await this.accountRepository.getByApId(
            new URL('https://mastodon.social/users/ghostexplore'),
        );

        if (!ghostExplore) {
            this.logger.error('Ghost Explore account not found');
            return;
        }

        this.logger.info(
            'Following Ghost Explore account for new account {apId}',
            {
                apId: account.apId.href,
            },
        );
        await this.accountService.followAccount(account, ghostExplore);
    }
}
