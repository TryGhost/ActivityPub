import type { Result } from '@/core/result';
import { ok } from '@/core/result';
import type {
    KnexPreferencesRepository,
    PreferencesDTO,
} from '@/preferences/preferences.repository.knex';
import type { Site } from '@/site/site.service';

export type PreferencesServiceError = never;

export class PreferencesService {
    constructor(
        private readonly preferencesRepository: KnexPreferencesRepository,
    ) {}

    async getForSite(
        site: Site,
    ): Promise<Result<PreferencesDTO, PreferencesServiceError>> {
        return ok(await this.preferencesRepository.getForSite(site.id));
    }

    async updateForSite(
        site: Site,
        preferences: PreferencesDTO,
    ): Promise<Result<PreferencesDTO, PreferencesServiceError>> {
        return ok(
            await this.preferencesRepository.updateForSite(
                site.id,
                preferences,
            ),
        );
    }
}
