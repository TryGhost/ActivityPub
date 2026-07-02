import type { Result } from '@/core/result';
import { error, ok } from '@/core/result';
import type {
    KnexPreferencesRepository,
    PreferencesDTO,
} from '@/preferences/preferences.repository.knex';
import { PreferencesUserNotFoundError } from '@/preferences/preferences.repository.knex';
import type { Site } from '@/site/site.service';

export type PreferencesServiceError =
    | { type: 'user-not-found'; siteId: number }
    | {
          type: 'unexpected-error';
          operation: 'get' | 'update';
          siteId: number;
          error: unknown;
      };

export class PreferencesService {
    constructor(
        private readonly preferencesRepository: KnexPreferencesRepository,
    ) {}

    async getForSite(
        site: Site,
    ): Promise<Result<PreferencesDTO, PreferencesServiceError>> {
        try {
            return ok(await this.preferencesRepository.getForSite(site.id));
        } catch (err) {
            return error(this.toServiceError(err, site.id, 'get'));
        }
    }

    async updateForSite(
        site: Site,
        preferences: PreferencesDTO,
    ): Promise<Result<PreferencesDTO, PreferencesServiceError>> {
        try {
            return ok(
                await this.preferencesRepository.updateForSite(
                    site.id,
                    preferences,
                ),
            );
        } catch (err) {
            return error(this.toServiceError(err, site.id, 'update'));
        }
    }

    private toServiceError(
        err: unknown,
        siteId: number,
        operation: 'get' | 'update',
    ): PreferencesServiceError {
        if (err instanceof PreferencesUserNotFoundError) {
            return { type: 'user-not-found', siteId: err.siteId };
        }

        return { type: 'unexpected-error', operation, siteId, error: err };
    }
}
