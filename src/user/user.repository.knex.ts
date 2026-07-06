import type { Knex } from 'knex';

export interface User {
    id: number;
    accountId: number;
    siteId: number;
}

export interface PreferencesDTO {
    showSensitiveMedia: boolean;
}

export class KnexUserRepository {
    constructor(private readonly db: Knex) {}

    async getByAccountId(accountId: number): Promise<User | null> {
        const row = await this.db('users')
            .select('id', 'account_id', 'site_id')
            .where({ account_id: accountId })
            .first();

        if (!row) {
            return null;
        }

        return {
            id: row.id,
            accountId: row.account_id,
            siteId: row.site_id,
        };
    }

    async getPreferences(userId: number): Promise<PreferencesDTO> {
        const row = await this.db('users')
            .select('show_sensitive_media')
            .where({ id: userId })
            .first();

        return {
            showSensitiveMedia: Boolean(row?.show_sensitive_media),
        };
    }

    async updatePreferences(
        userId: number,
        preferences: PreferencesDTO,
    ): Promise<void> {
        await this.db('users').where({ id: userId }).update({
            show_sensitive_media: preferences.showSensitiveMedia,
        });
    }
}
