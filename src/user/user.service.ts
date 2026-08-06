import type { Result } from '@/core/result';
import { error, ok } from '@/core/result';
import type {
    KnexUserRepository,
    PreferencesDTO,
    User,
} from '@/user/user.repository.knex';

export type UserNotFoundError = { type: 'user-not-found'; accountId: number };

export type UserPreferencesError = {
    type: 'unexpected-error';
    operation: 'get-preferences' | 'update-preferences';
    userId: number;
    error: unknown;
};

export class UserService {
    constructor(private readonly userRepository: KnexUserRepository) {}

    async getUserByAccountId(
        accountId: number,
    ): Promise<Result<User, UserNotFoundError>> {
        const user = await this.userRepository.getByAccountId(accountId);

        if (user === null) {
            return error({ type: 'user-not-found', accountId });
        }

        return ok(user);
    }

    async getPreferences(
        userId: number,
    ): Promise<Result<PreferencesDTO, UserPreferencesError>> {
        try {
            return ok(await this.userRepository.getPreferences(userId));
        } catch (err) {
            return error({
                type: 'unexpected-error',
                operation: 'get-preferences',
                userId,
                error: err,
            });
        }
    }

    async updatePreferences(
        userId: number,
        preferences: PreferencesDTO,
    ): Promise<Result<PreferencesDTO, UserPreferencesError>> {
        try {
            await this.userRepository.updatePreferences(userId, preferences);

            return ok(preferences);
        } catch (err) {
            return error({
                type: 'unexpected-error',
                operation: 'update-preferences',
                userId,
                error: err,
            });
        }
    }
}
