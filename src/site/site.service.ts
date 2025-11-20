import crypto from 'node:crypto';

import type { Knex } from 'knex';

import type { AccountService } from '@/account/account.service';
import type { InternalAccountData } from '@/account/types';
import type { getSiteSettings } from '@/helpers/ghost';

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
    ) {}

    private async createSite(
        host: string,
        ghostUuid: string | null = null,
        isGhostPro: boolean,
    ): Promise<Site> {
        const rows = await this.client
            .select('*')
            .from('sites')
            .where({ host });

        if (rows && rows.length !== 0) {
            throw new Error(`Site already exists for ${host}`);
        }

        const webhook_secret = crypto.randomBytes(32).toString('hex');

        // If a site already exists with this ghost_uuid, nullify it
        // This handles the case where a site changes domains and re-registers
        if (ghostUuid !== null) {
            await this.client('sites')
                .where({ ghost_uuid: ghostUuid })
                .update({ ghost_uuid: null });
        }

        const [id] = await this.client
            .insert({
                host,
                webhook_secret,
                ghost_pro: isGhostPro,
                ghost_uuid: ghostUuid,
            })
            .into('sites');

        return {
            id,
            host,
            webhook_secret,
            ghost_uuid: ghostUuid,
        };
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
        const settings = await this.ghostService.getSiteSettings(host);

        if (!settings?.site?.site_uuid) {
            throw new Error(`Site ${host} has no site_uuid`);
        }

        let site: Site;
        if (existingSite === null) {
            site = await this.createSite(
                host,
                settings.site.site_uuid,
                isGhostPro,
            );
        } else {
            site = existingSite;
        }

        const existingAccount =
            (existingSite &&
                (await this.client('accounts')
                    .join('users', 'accounts.id', 'users.account_id')
                    .where('users.site_id', site.id)
                    .first())) ||
            null;

        if (existingAccount === null) {
            const internalAccountData: InternalAccountData = {
                username: 'index',
                name: settings?.site?.title,
                bio: settings?.site?.description || null,
                avatar_url: settings?.site?.icon || null,
                banner_image_url: settings?.site?.cover_image || null,
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
}
