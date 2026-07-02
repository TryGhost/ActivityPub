import type { Knex } from 'knex';

export interface PreferencesDTO {
    showSensitiveMedia: boolean;
}

export class KnexPreferencesRepository {
    constructor(private readonly db: Knex) {}

    async getForSite(siteId: number): Promise<PreferencesDTO> {
        const user = await this.db('users')
            .select('show_sensitive_media')
            .where({ site_id: siteId })
            .first();

        return {
            showSensitiveMedia: Boolean(user?.show_sensitive_media),
        };
    }

    async updateForSite(
        siteId: number,
        preferences: PreferencesDTO,
    ): Promise<PreferencesDTO> {
        await this.db('users').where({ site_id: siteId }).update({
            show_sensitive_media: preferences.showSensitiveMedia,
        });

        return preferences;
    }
}
