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

    private async createSite(host: string, conn: Knex): Promise<Site> {
        console.time(`createSite internal for ${host}`);

        console.time(`check existing site for ${host}`);
        const rows = await conn.select('*').from('sites').where({ host });
        console.timeEnd(`check existing site for ${host}`);

        if (rows && rows.length !== 0) {
            console.log(`Site already exists for ${host}, throwing error`);
            throw new Error(`Site already exists for ${host}`);
        }

        console.time(`generate webhook_secret for ${host}`);
        const webhook_secret = crypto.randomBytes(32).toString('hex');
        console.timeEnd(`generate webhook_secret for ${host}`);

        console.time(`insert site for ${host}`);
        const [id] = await conn
            .insert({
                host,
                webhook_secret,
            })
            .into('sites');
        console.timeEnd(`insert site for ${host}`);

        console.log(`Site created with id ${id} for ${host}`);
        console.timeEnd(`createSite internal for ${host}`);

        return {
            id,
            host,
            webhook_secret,
        };
    }

    public async getSiteByHost(
        host: string,
        conn: Knex = this.client,
    ): Promise<Site | null> {
        const rows = await conn.select('*').from('sites').where({
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
        console.time(`initialiseSiteForHost ${host}`);
        return await this.client.transaction(async (tx) => {
            try {
                console.log(`Transaction started for host: ${host}`);

                console.time(`getSiteByHost for ${host}`);
                const existingSite = await this.getSiteByHost(host, tx);
                console.timeEnd(`getSiteByHost for ${host}`);

                if (existingSite !== null) {
                    console.log(`Existing site found for ${host}, returning`);
                    console.timeEnd(`initialiseSiteForHost ${host}`);
                    return existingSite;
                }

                console.time(`createSite for ${host}`);
                const newSite = await this.createSite(host, tx);
                console.timeEnd(`createSite for ${host}`);
                console.log(
                    `New site created for ${host} with id ${newSite.id}`,
                );

                console.time(`getSiteSettings for ${host}`);
                const settings = await this.ghostService.getSiteSettings(
                    newSite.host,
                );
                console.timeEnd(`getSiteSettings for ${host}`);

                const internalAccountData: InternalAccountData = {
                    username: 'index',
                    name: settings?.site?.title,
                    bio: settings?.site?.description,
                    avatar_url: settings?.site?.icon,
                };

                console.log(`Creating internal account for site ${host}`);
                await this.accountService.createInternalAccount(
                    newSite,
                    internalAccountData,
                    tx,
                );

                console.log(`Transaction completed for host: ${host}`);
                console.timeEnd(`initialiseSiteForHost ${host}`);
                return newSite;
            } catch (error) {
                console.error(
                    `Error in initialiseSiteForHost for ${host}:`,
                    error,
                );
                throw error;
            }
        });
    }

    public async refreshSiteDataForHost(host: string): Promise<void> {
        const site = await this.getSiteByHost(host);
        if (!site) {
            throw new Error(`Could not find site for ${host}`);
        }

        const account =
            await this.accountService.getDefaultAccountForSite(site);

        const settings = await this.ghostService.getSiteSettings(site.host);

        await this.accountService.updateAccount(account, {
            avatar_url: settings.site.icon,
            name: settings.site.title,
            bio: settings.site.description,
        });
    }
}
