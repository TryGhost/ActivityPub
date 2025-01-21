import crypto from 'node:crypto';
import type { Knex } from 'knex';

export type Site = {
    id: number;
    host: string;
    webhook_secret: string;
};

export class SiteService {
    constructor(private client: Knex) {}

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

    public async initialiseSiteForHost(host: string) {
        const existingSite = await this.getSiteByHost(host);
        if (existingSite !== null) {
            return existingSite;
        }

        await this.createSite(host);

        const newSite = await this.getSiteByHost(host);

        return newSite;
    }
}
