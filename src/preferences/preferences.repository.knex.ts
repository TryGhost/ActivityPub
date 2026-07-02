import type { Knex } from 'knex';

import type { Result } from '@/core/result';
import { error, ok } from '@/core/result';

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

    async getForSite(
        siteId: number,
    ): Promise<Result<PreferencesDTO, PreferencesUserNotFoundError>> {
        const user = await this.db('users')
            .select('show_sensitive_media')
            .where({ site_id: siteId })
            .first();

        if (!user) {
            return error(new PreferencesUserNotFoundError(siteId));
        }

        return ok({
            showSensitiveMedia: Boolean(user.show_sensitive_media),
        });
    }

    async updateForSite(
        siteId: number,
        preferences: PreferencesDTO,
    ): Promise<Result<PreferencesDTO, PreferencesUserNotFoundError>> {
        return this.db.transaction(async (trx) => {
            const userExists = await trx('users')
                .select('id')
                .where({ site_id: siteId })
                .forUpdate()
                .first();

            if (!userExists) {
                return error(new PreferencesUserNotFoundError(siteId));
            }

            const affectedRows = await trx('users')
                .where({ site_id: siteId })
                .update({
                    show_sensitive_media: preferences.showSensitiveMedia,
                });

            if (affectedRows === 0) {
                return error(new PreferencesUserNotFoundError(siteId));
            }

            return ok(preferences);
        });
    }
}
