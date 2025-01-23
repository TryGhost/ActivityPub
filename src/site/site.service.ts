import crypto from 'node:crypto';
import type { Knex } from 'knex';
import type { AccountService } from '../account/account.service';
import type { Account } from '../account/types';
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

    private async createSite(host: string): Promise<void> {
        const rows = await this.client
            .select('*')
            .from('sites')
            .where({ host });

        if (rows && rows.length !== 0) {
            throw new Error(`Site already exists for ${host}`);
        }

        const webhook_secret = crypto.randomBytes(32).toString('hex');
        await this.client
            .insert({
                host,
                webhook_secret,
            })
            .into('sites');

        return;
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

    public async initialiseSiteForHost(host: string): Promise<Site> {
        const existingSite = await this.getSiteByHost(host);
        if (existingSite !== null) {
            return existingSite;
        }

        await this.createSite(host);

        const newSite = await this.getSiteByHost(host);

        if (newSite === null) {
            throw new Error(`Site initialisation failed for ${host}`);
        }

        const internalAccount = await this.accountService.createInternalAccount(
            newSite,
            'index',
        );

        return newSite;
    }

    public async getDefaultAccountForSite(site: Site): Promise<Account> {
        const rows = await this.client('users')
            .select('account_id')
            .where({ site_id: site.id });

        if (!rows || !rows.length) {
            throw new Error(`User not found for site ${site.id}`);
        }

        if (rows.length !== 1) {
            throw new Error(`Multiple users found for site ${site.id}`);
        }

        const account = await this.accountService.getByInternalId(
            rows[0].account_id,
        );

        if (account === null) {
            throw new Error(`Default Account not found for site ${site.id}`);
        }

        return account;
    }

    public async refreshSiteDataForHost(host: string): Promise<void> {
        const site = await this.getSiteByHost(host);
        if (!site) {
            throw new Error(`Could not find site for ${host}`);
        }

        const account = await this.getDefaultAccountForSite(site);

        const settings = await this.ghostService.getSiteSettings(site.host);

        await this.accountService.updateAccount(account, {
            avatar_url: settings.site.icon,
            name: settings.site.title,
            bio: settings.site.description,
        });
    }
}
