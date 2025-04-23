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
        const rows = await conn.select('*').from('sites').where({ host });

        if (rows && rows.length !== 0) {
            throw new Error(`Site already exists for ${host}`);
        }

        const webhook_secret = crypto.randomBytes(32).toString('hex');
        const [id] = await conn
            .insert({
                host,
                webhook_secret,
            })
            .into('sites');

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
        return await this.client.transaction(async (tx) => {
            const existingSite = await this.getSiteByHost(host, tx);
            if (existingSite !== null) {
                return existingSite;
            }

            const newSite = await this.createSite(host, tx);

            const settings = await this.ghostService.getSiteSettings(
                newSite.host,
            );

            const internalAccountData: InternalAccountData = {
                username: 'index',
                name: settings?.site?.title,
                bio: settings?.site?.description || null,
                avatar_url: settings?.site?.icon || null,
            };

            await this.accountService.createInternalAccount(
                newSite,
                internalAccountData,
                tx,
            );

            return newSite;
        });
    }
}
