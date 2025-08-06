import type { KnexAccountRepository } from '@/account/account.repository.knex';
import type { AccountService } from '@/account/account.service';
import { AccountCreatedEvent } from '@/account/events';
import type { FedifyContextFactory } from '@/activitypub/fedify-context.factory';
import type { AsyncEvents } from '@/core/events';
import { getValue, isError } from '@/core/result';
import { Follow } from '@fedify/fedify';
import type { Logger } from '@logtape/logtape';
import { uuid4 } from '@sentry/core';

export class GhostExploreService {
    constructor(
        private readonly events: AsyncEvents,
        private readonly accountRepository: KnexAccountRepository,
        private readonly accountService: AccountService,
        private readonly logger: Logger,
        private readonly fedifyContextFactory: FedifyContextFactory,
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

        const ghostExploreResult = await this.accountService.ensureByApId(
            new URL('https://mastodon.social/users/ghostexplore'),
        );

        if (isError(ghostExploreResult)) {
            this.logger.error('Ghost Explore account not found');
            return;
        }

        const ghostExplore = getValue(ghostExploreResult);

        this.logger.info(
            'Following Ghost Explore account for new account {apId}',
            {
                apId: account.apId.href,
            },
        );

        const apCtx = this.fedifyContextFactory.getFedifyContext();

        const followId = apCtx.getObjectUri(Follow, {
            id: uuid4(),
        });

        const follow = new Follow({
            id: followId,
            actor: account.apId,
            object: ghostExplore.apId,
        });

        const followJson = await follow.toJsonLd();

        apCtx.data.globaldb.set([follow.id!.href], followJson);

        await apCtx.sendActivity(
            { username: account.username },
            {
                id: ghostExplore.apId,
                inboxId: ghostExplore.apInbox,
            },
            follow,
        );
    }
}
