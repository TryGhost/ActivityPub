import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccountEntity } from '@/account/account.entity';
import type { KnexAccountRepository } from '@/account/account.repository.knex';
import { AccountService } from '@/account/account.service';
import type { FedifyContextFactory } from '@/activitypub/fedify-context.factory';
import type { AsyncEvents } from '@/core/events';
import type { Knex } from 'knex';

describe('AccountService', () => {
    let knex: Knex;
    let asyncEvents: AsyncEvents;
    let knexAccountRepository: KnexAccountRepository;
    let fedifyContextFactory: FedifyContextFactory;
    let generateKeyPair: () => Promise<CryptoKeyPair>;
    let accountService: AccountService;

    beforeEach(() => {
        knex = {} as Knex;
        asyncEvents = {} as AsyncEvents;
        knexAccountRepository = {
            save: vi.fn(),
            getById: vi.fn(),
            getByApId: vi.fn(),
            getByInboxUrl: vi.fn(),
        } as unknown as KnexAccountRepository;
        fedifyContextFactory = {} as FedifyContextFactory;
        generateKeyPair = vi.fn();

        accountService = new AccountService(
            knex,
            asyncEvents,
            knexAccountRepository,
            fedifyContextFactory,
            generateKeyPair,
        );
    });

    describe('updateAccountProfile', () => {
        it('should update the account profile with the provided data', async () => {
            const updated = {} as unknown as AccountEntity;
            const account = {
                updateProfile: vi.fn().mockReturnValue(updated),
            } as unknown as AccountEntity;
            const data = {
                name: 'Alice',
                bio: 'Eiusmod in cillum elit sit cupidatat reprehenderit ad quis qui consequat officia elit.',
                username: 'alice',
                avatarUrl: 'https://example.com/avatar/alice.png',
                bannerImageUrl: 'https://example.com/banner/alice.png',
            };

            await accountService.updateAccountProfile(account, data);

            expect(account.updateProfile).toHaveBeenCalledWith({
                name: data.name,
                bio: data.bio,
                username: data.username,
                avatarUrl: new URL(data.avatarUrl),
                bannerImageUrl: new URL(data.bannerImageUrl),
            });

            expect(knexAccountRepository.save).toHaveBeenCalledWith(updated);
        });

        it('should handle empty values for avatarUrl and bannerImageUrl', async () => {
            const account = {
                updateProfile: vi.fn(),
            } as unknown as AccountEntity;

            await accountService.updateAccountProfile(account, {
                name: 'Alice',
                bio: 'Eiusmod in cillum elit sit cupidatat reprehenderit ad quis qui consequat officia elit.',
                username: 'alice',
                avatarUrl: '',
                bannerImageUrl: '',
            });

            expect(account.updateProfile).toHaveBeenCalledWith({
                name: 'Alice',
                bio: 'Eiusmod in cillum elit sit cupidatat reprehenderit ad quis qui consequat officia elit.',
                username: 'alice',
                avatarUrl: null,
                bannerImageUrl: null,
            });
        });
    });

    describe('updateAccountByApId', () => {
        it('should update the account with the provided data', async () => {
            const updated = {} as unknown as AccountEntity;
            const account = {
                updateProfile: vi.fn().mockReturnValue(updated),
            } as unknown as AccountEntity;

            vi.mocked(knexAccountRepository.getByApId).mockImplementation(() =>
                Promise.resolve(account),
            );

            const data = {
                name: 'Alice',
                bio: 'Eiusmod in cillum elit sit cupidatat reprehenderit ad quis qui consequat officia elit.',
                username: 'alice',
                avatarUrl: 'https://example.com/avatar/alice.png',
                bannerImageUrl: 'https://example.com/banner/alice.png',
                url: 'https://example.com/url/alice',
                customFields: {
                    foo: 'bar',
                },
            };

            await accountService.updateAccountByApId(account.apId, data);

            expect(account.updateProfile).toHaveBeenCalledWith({
                name: data.name,
                bio: data.bio,
                username: data.username,
                avatarUrl: new URL(data.avatarUrl),
                bannerImageUrl: new URL(data.bannerImageUrl),
                url: new URL(data.url),
                customFields: data.customFields,
            });

            expect(knexAccountRepository.save).toHaveBeenCalledWith(updated);
        });

        it('should handle empty values for avatarUrl, bannerImageUrl, url, and customFields', async () => {
            const account = {
                updateProfile: vi.fn(),
            } as unknown as AccountEntity;

            vi.mocked(knexAccountRepository.getByApId).mockImplementation(() =>
                Promise.resolve(account),
            );

            await accountService.updateAccountByApId(account.apId, {
                name: 'Alice',
                bio: 'Eiusmod in cillum elit sit cupidatat reprehenderit ad quis qui consequat officia elit.',
                username: 'alice',
                avatarUrl: '',
                bannerImageUrl: '',
                url: '',
                customFields: null,
            });

            expect(account.updateProfile).toHaveBeenCalledWith({
                name: 'Alice',
                bio: 'Eiusmod in cillum elit sit cupidatat reprehenderit ad quis qui consequat officia elit.',
                username: 'alice',
                avatarUrl: null,
                bannerImageUrl: null,
                url: null,
                customFields: null,
            });
        });
    });

    describe('getAccountById', () => {
        it('should return the result from the account repository', async () => {
            const accountId = 1;
            const account = { id: accountId } as unknown as AccountEntity;

            vi.mocked(knexAccountRepository.getById).mockImplementation(
                (_id) => {
                    if (_id === accountId) {
                        return Promise.resolve(account);
                    }

                    return Promise.resolve(null);
                },
            );

            const result = await accountService.getAccountById(accountId);

            expect(result).toBe(account);
        });
    });

    describe('followAccount', () => {
        it('should follow an account', async () => {
            const account = {
                id: 1,
                follow: vi.fn(),
            } as unknown as AccountEntity;
            const accountToFollow = { id: 2 } as unknown as AccountEntity;
            const updatedAccount = {
                id: 1,
            } as unknown as AccountEntity;

            vi.mocked(account.follow).mockImplementation(() => updatedAccount);

            await accountService.followAccount(account, accountToFollow);

            expect(account.follow).toHaveBeenCalledWith(accountToFollow);
            expect(knexAccountRepository.save).toHaveBeenCalledWith(
                updatedAccount,
            );
        });
    });

    describe('unfollowAccount', () => {
        it('should unfollow an account', async () => {
            const account = {
                id: 1,
                unfollow: vi.fn(),
            } as unknown as AccountEntity;
            const accountToUnfollow = { id: 2 } as unknown as AccountEntity;
            const updatedAccount = {
                id: 1,
            } as unknown as AccountEntity;

            vi.mocked(account.unfollow).mockImplementation(
                () => updatedAccount,
            );

            await accountService.unfollowAccount(account, accountToUnfollow);

            expect(account.unfollow).toHaveBeenCalledWith(accountToUnfollow);
            expect(knexAccountRepository.save).toHaveBeenCalledWith(
                updatedAccount,
            );
        });
    });

    describe('readAllNotifications', () => {
        it('should read all notifications', async () => {
            const account = {
                id: 1,
                readAllNotifications: vi.fn(),
            } as unknown as AccountEntity;
            const updatedAccount = {
                id: 1,
            } as unknown as AccountEntity;

            vi.mocked(account.readAllNotifications).mockImplementation(
                () => updatedAccount,
            );

            await accountService.readAllNotifications(account);

            expect(account.readAllNotifications).toHaveBeenCalled();
            expect(knexAccountRepository.save).toHaveBeenCalledWith(
                updatedAccount,
            );
        });
    });
});
