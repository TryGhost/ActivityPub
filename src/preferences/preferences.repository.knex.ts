import type { Knex } from 'knex';

export interface PreferencesDTO {
    showSensitiveMedia: boolean;
}

export class PreferencesUserNotFoundError extends Error {
    constructor(readonly siteId: number) {
        super(`No user found for site_id ${siteId}`);
        this.name = 'PreferencesUserNotFoundError';
    }
}

export class KnexPreferencesRepository {
    constructor(private readonly db: Knex) {}

    async getForSite(siteId: number): Promise<PreferencesDTO> {
        const user = await this.db('users')
            .select('show_sensitive_media')
            .where({ site_id: siteId })
            .first();

        if (!user) {
            throw new PreferencesUserNotFoundError(siteId);
        }

        return {
            showSensitiveMedia: Boolean(user.show_sensitive_media),
        };
    }

    async updateForSite(
        siteId: number,
        preferences: PreferencesDTO,
    ): Promise<PreferencesDTO> {
        const userExists = await this.db('users')
            .select('id')
            .where({ site_id: siteId })
            .first();

        if (!userExists) {
            throw new PreferencesUserNotFoundError(siteId);
        }

        await this.db('users').where({ site_id: siteId }).update({
            show_sensitive_media: preferences.showSensitiveMedia,
        });

        return preferences;
    }
}
