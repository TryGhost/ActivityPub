import type EventEmitter from 'node:events';

import type { Logger } from '@logtape/logtape';
import * as Sentry from '@sentry/node';
import type { Knex } from 'knex';

import type { KnexAccountRepository } from '@/account/account.repository.knex';
import type { BlueskyService } from '@/integration/bluesky.service';
import type { Site } from '@/site/site.service';
import { SiteCreatedEvent } from '@/site/site-created.event';

export class BlueskyEventService {
    constructor(
        private readonly db: Knex,
        private readonly events: EventEmitter,
        private readonly blueskyService: BlueskyService,
        private readonly accountRepository: KnexAccountRepository,
        private readonly logger: Logger,
    ) {}

    init() {
        this.events.on(
            SiteCreatedEvent.getName(),
            this.handleSiteCreated.bind(this),
        );
    }

    private async handleSiteCreated(event: SiteCreatedEvent) {
        try {
            const site = await this.db('sites')
                .where('id', event.getSiteId())
                .first<Site>();

            if (!site) {
                this.logger.warn(
                    'Ignoring site.created for missing site {siteId}',
                    { siteId: event.getSiteId() },
                );
                return;
            }

            const account = await this.accountRepository.getBySite(site);

            if (!account) {
                this.logger.warn(
                    'Ignoring site.created for site {siteId} with no account',
                    { siteId: event.getSiteId() },
                );
                return;
            }

            await this.blueskyService.reconnectForAccount(
                account,
                event.getSiteId(),
            );
        } catch (error) {
            Sentry.captureException(error);
            this.logger.error(
                'Best-effort Bridgy restore failed for site {siteId}',
                { siteId: event.getSiteId(), error },
            );
        }
    }
}
