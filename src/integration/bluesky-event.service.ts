import type EventEmitter from 'node:events';

import type { Logger } from '@logtape/logtape';

import type { KnexAccountRepository } from '@/account/account.repository.knex';
import type { BlueskyService } from '@/integration/bluesky.service';
import type { SiteService } from '@/site/site.service';
import { SiteCreatedEvent } from '@/site/site-created.event';
import { SiteDisablingEvent } from '@/site/site-disabling.event';

export class BlueskyEventService {
    constructor(
        private readonly events: EventEmitter,
        private readonly blueskyService: BlueskyService,
        private readonly siteService: SiteService,
        private readonly accountRepository: KnexAccountRepository,
        private readonly logger: Logger,
    ) {}

    init() {
        this.events.on(
            SiteCreatedEvent.getName(),
            this.handleSiteCreated.bind(this),
        );
        this.events.on(
            SiteDisablingEvent.getName(),
            this.handleSiteDisabling.bind(this),
        );
    }

    private async handleSiteCreated(event: SiteCreatedEvent) {
        try {
            const account = await this.getAccountForEvent(event);

            if (!account) {
                return;
            }

            await this.blueskyService.reconnectForAccount(account);
        } catch (error) {
            this.logger.error(
                'Best-effort Bridgy restore failed for site {host}',
                { host: event.getSiteHost(), error },
            );
        }
    }

    private async handleSiteDisabling(event: SiteDisablingEvent) {
        try {
            const account = await this.getAccountForEvent(event);

            if (account) {
                await this.blueskyService.disconnectForAccount(account);
            }
        } catch (error) {
            this.logger.error('Could not disconnect Bridgy for site {host}', {
                host: event.getSiteHost(),
                error,
            });
        }
    }

    private async getAccountForEvent(
        event: SiteCreatedEvent | SiteDisablingEvent,
    ) {
        const site = await this.siteService.getSiteByHost(event.getSiteHost());

        if (!site) {
            return null;
        }

        return this.accountRepository.getBySite(site);
    }
}
