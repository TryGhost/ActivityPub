import crypto from 'node:crypto';
import type { Knex } from 'knex';
import type { AccountService } from '../account/account.service';
import type { InternalAccountData } from '../account/types';
import type { getSiteSettings } from '../helpers/ghost';

export type Site = {
    id: number;
    host: string;
    webhook_secret: string;
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

    private async createSite(host: string, isGhostPro: boolean): Promise<Site> {
        const rows = await this.client
            .select('*')
            .from('sites')
            .where({ host });

        if (rows && rows.length !== 0) {
            throw new Error(`Site already exists for ${host}`);
        }

        const webhook_secret = crypto.randomBytes(32).toString('hex');
        const [id] = await this.client
            .insert({
                host,
                webhook_secret,
                ghost_pro: isGhostPro,
            })
            .into('sites');

        return {
            id,
            host,
            webhook_secret,
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
        };
    }

    public async initialiseSiteForHost(
        host: string,
        isGhostPro = false,
    ): Promise<Site> {
        const existingSite = await this.getSiteByHost(host);

        let site: Site;
        if (existingSite === null) {
            site = await this.createSite(host, isGhostPro);
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
            const settings = await this.ghostService.getSiteSettings(site.host);

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
