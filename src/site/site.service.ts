import crypto from 'node:crypto';

import type { Logger } from '@logtape/logtape';
import type { Knex } from 'knex';

import type { AccountService } from '@/account/account.service';
import type { InternalAccountData } from '@/account/types';
import type { getSiteSettings, SiteSettings } from '@/helpers/ghost';
import { classifyGhostUuidOwnership } from '@/site/ghost-uuid-ownership';

export type Site = {
    id: number;
    host: string;
    webhook_secret: string;
    ghost_uuid: string | null;
};

export interface IGhostService {
    getSiteSettings: typeof getSiteSettings;
}

export class SiteService {
    constructor(
        private client: Knex,
        private accountService: AccountService,
        private ghostService: IGhostService,
        private logger: Logger,
    ) {}

    private async createSite(
        host: string,
        ghostUuid: string | null = null,
        isGhostPro: boolean,
    ): Promise<Site> {
        const hostExists = await this.client
            .select('*')
            .from('sites')
            .where({ host })
            .first();

        if (hostExists) {
            throw new Error(`Site already exists for ${host}`);
        }

        let verifiedOwnerHost: string | null = null;

        if (ghostUuid !== null) {
            const currentOwner = await this.client('sites')
                .select('id', 'host', 'webhook_secret')
                .where({ ghost_uuid: ghostUuid })
                .first();

            if (currentOwner) {
                const resolution = await this.resolveUuidConflict(
                    currentOwner.host,
                    host,
                    ghostUuid,
                );

                if (resolution === 'move-site') {
                    return await this.moveSiteToHost(
                        currentOwner.id,
                        host,
                        isGhostPro,
                        currentOwner.webhook_secret,
                        ghostUuid,
                    );
                }

                verifiedOwnerHost = currentOwner.host;
            }
        }

        const webhook_secret = crypto.randomBytes(32).toString('hex');

        return await this.client.transaction(async (trx) => {
            if (verifiedOwnerHost) {
                await trx('sites')
                    .where({ host: verifiedOwnerHost, ghost_uuid: ghostUuid })
                    .update({ ghost_uuid: null });
            }

            const [id] = await trx('sites').insert({
                host,
                webhook_secret,
                ghost_pro: isGhostPro,
                ghost_uuid: ghostUuid,
            });

            return {
                id,
                host,
                webhook_secret,
                ghost_uuid: ghostUuid,
            };
        });
    }

    public async getSiteByHost(host: string): Promise<Site | null> {
        const rows = await this.client.select('*').from('sites').where({
            host,
        });

        if (!rows || !rows.length) {
            return null;
        }

        if (rows.length > 1) {
            throw new Error(`More than one row found for site ${host}`);
        }

        return {
            id: rows[0].id,
            host: rows[0].host,
            webhook_secret: rows[0].webhook_secret,
            ghost_uuid: rows[0].ghost_uuid || null,
        };
    }

    public async initialiseSiteForHost(
        host: string,
        isGhostPro = false,
    ): Promise<Site> {
        const existingSite = await this.getSiteByHost(host);

        let site: Site;
        let settings: SiteSettings | undefined;

        if (existingSite === null) {
            settings = await this.getSiteSettings(host);

            site = await this.createSite(
                host,
                settings.site.site_uuid,
                isGhostPro,
            );
        } else {
            site = existingSite;
        }

        // The site can already have an account even when the host lookup
        // missed: createSite may have moved an existing site to this host
        const existingAccount =
            (await this.client('accounts')
                .join('users', 'accounts.id', 'users.account_id')
                .where('users.site_id', site.id)
                .first()) || null;

        if (existingAccount === null) {
            settings ??= await this.getSiteSettings(host);

            const internalAccountData: InternalAccountData = {
                username: 'index',
                name: settings.site.title,
                bio: settings.site.description,
                avatar_url: settings.site.icon,
                banner_image_url: settings.site.cover_image,
            };

            await this.accountService.createInternalAccount(
                site,
                internalAccountData,
            );
        }

        return site;
    }

    public async disableSiteForHost(host: string): Promise<boolean> {
        const result = await this.client.delete().from('sites').where({ host });

        return result === 1;
    }

    /**
     * Decide what to do when a new host registers with a `ghost_uuid`
     * that already belongs to an existing site.
     *
     * - `move-site`: the previous host no longer serves the install, so
     *   this is the same site whose URL changed. The existing site row
     *   (and with it the account, followers and webhook secret) moves to
     *   the new host.
     * - `release-uuid`: the new host registers as its own site and takes
     *   the UUID from the previous row.
     *
     * See docs/site-registration.md for the full decision table.
     */
    private async resolveUuidConflict(
        previousHost: string,
        newHost: string,
        ghostUuid: string,
    ): Promise<'move-site' | 'release-uuid'> {
        const result = await classifyGhostUuidOwnership(
            previousHost,
            ghostUuid,
            (host) => this.ghostService.getSiteSettings(host),
        );

        if (result.type === 'still-claims') {
            throw new Error('ghost_uuid is still claimed by another host');
        }

        if (result.type === 'unverifiable') {
            // Fail-open: a transient or ambiguous response from the
            // previous host should not block legitimate domain changes.
            // The trade-off is accepted; see docs/site-registration.md.
            this.logger.warn(
                'Reassigning ghost_uuid despite unverifiable response from previous host {previousHost} (reason: {reason}); transferring to {newHost}',
                {
                    previousHost,
                    newHost,
                    ghostUuid,
                    reason: result.reason,
                },
            );
            return 'release-uuid';
        }

        if (result.reason === 'aliased') {
            // The previous host still serves the install (e.g. a managed
            // hosting backend hostname behind a customer's custom
            // domain), so the new canonical host registers as its own
            // site rather than taking over the previous one.
            this.logger.info(
                'Previous host {previousHost} has released ghost_uuid (reason: {reason}); transferring to {newHost}',
                {
                    previousHost,
                    newHost,
                    ghostUuid,
                    reason: result.reason,
                },
            );
            return 'release-uuid';
        }

        this.logger.info(
            'Previous host {previousHost} no longer serves ghost_uuid (reason: {reason}); moving site to {newHost}',
            {
                previousHost,
                newHost,
                ghostUuid,
                reason: result.reason,
            },
        );
        return 'move-site';
    }

    /**
     * Move an existing site to a new host after its Ghost URL changed.
     * The site row keeps its id, webhook secret and `ghost_uuid`, so the
     * account attached to it (followers, posts, keys) is preserved.
     * Actor URLs are not rewritten; changing the federated identity is a
     * separate actor migration concern.
     */
    private async moveSiteToHost(
        siteId: number,
        host: string,
        isGhostPro: boolean,
        webhookSecret: string,
        ghostUuid: string,
    ): Promise<Site> {
        await this.client('sites').where({ id: siteId }).update({
            host,
            ghost_pro: isGhostPro,
        });

        return {
            id: siteId,
            host,
            webhook_secret: webhookSecret,
            ghost_uuid: ghostUuid,
        };
    }

    private async getSiteSettings(host: string): Promise<SiteSettings> {
        const settings = await this.ghostService.getSiteSettings(host);

        if (!settings?.site?.site_uuid) {
            throw new Error(`Site ${host} has no site_uuid`);
        }

        return settings;
    }
}
