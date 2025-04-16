import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FedifyContextFactory } from 'activitypub/fedify-context.factory';
import type { AsyncEvents } from 'core/events';
import type { Knex } from 'knex';
import type { Account } from './account.entity';
import type { KnexAccountRepository } from './account.repository.knex';
import { AccountService } from './account.service';

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
            const account = {
                updateProfile: vi.fn(),
            } as unknown as Account;
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

            expect(knexAccountRepository.save).toHaveBeenCalledWith(account);
        });

        it('should do nothing if the provided data is the same as the existing account profile', async () => {
            const data = {
                name: 'Alice',
                bio: 'Eiusmod in cillum elit sit cupidatat reprehenderit ad quis qui consequat officia elit.',
                username: 'alice',
                avatarUrl: 'https://example.com/avatar/alice.png',
                bannerImageUrl: 'https://example.com/banner/alice.png',
            };

            const account = {
                name: data.name,
                bio: data.bio,
                username: data.username,
                avatarUrl: new URL(data.avatarUrl),
                bannerImageUrl: new URL(data.bannerImageUrl),
                updateProfile: vi.fn(),
            } as unknown as Account;

            await accountService.updateAccountProfile(account, {
                name: data.name,
                bio: data.bio,
                username: data.username,
                avatarUrl: data.avatarUrl,
                bannerImageUrl: data.bannerImageUrl,
            });

            expect(knexAccountRepository.save).not.toHaveBeenCalled();
        });
    });
});
