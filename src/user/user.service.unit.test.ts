import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getError, getValue, isError } from '@/core/result';
import type { KnexUserRepository } from '@/user/user.repository.knex';
import { UserService } from '@/user/user.service';

describe('UserService', () => {
    let userRepository: KnexUserRepository;
    let userService: UserService;

    beforeEach(() => {
        userRepository = {
            getByAccountId: vi.fn(),
            getPreferences: vi.fn(),
            updatePreferences: vi.fn(),
        } as unknown as KnexUserRepository;

        userService = new UserService(userRepository);
    });

    describe('getPreferences', () => {
        it('returns stored preferences', async () => {
            vi.mocked(userRepository.getPreferences).mockResolvedValue({
                showSensitiveMedia: true,
            });

            const result = await userService.getPreferences(1);

            expect(isError(result)).toBe(false);
            if (!isError(result)) {
                expect(getValue(result)).toEqual({
                    showSensitiveMedia: true,
                });
            }
        });

        it('returns user-not-found when the user row is missing', async () => {
            vi.mocked(userRepository.getPreferences).mockResolvedValue(null);

            const result = await userService.getPreferences(42);

            expect(isError(result)).toBe(true);
            if (isError(result)) {
                expect(getError(result)).toEqual({
                    type: 'user-not-found',
                    userId: 42,
                });
            }
        });
    });

    describe('updatePreferences', () => {
        it('returns the updated preferences', async () => {
            vi.mocked(userRepository.updatePreferences).mockResolvedValue(true);

            const result = await userService.updatePreferences(1, {
                showSensitiveMedia: false,
            });

            expect(isError(result)).toBe(false);
            if (!isError(result)) {
                expect(getValue(result)).toEqual({
                    showSensitiveMedia: false,
                });
            }
        });

        it('returns user-not-found when the user row is missing', async () => {
            vi.mocked(userRepository.updatePreferences).mockResolvedValue(
                false,
            );

            const result = await userService.updatePreferences(42, {
                showSensitiveMedia: true,
            });

            expect(isError(result)).toBe(true);
            if (isError(result)) {
                expect(getError(result)).toEqual({
                    type: 'user-not-found',
                    userId: 42,
                });
            }
        });
    });
});
