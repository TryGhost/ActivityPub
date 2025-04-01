import type { Context } from '@fedify/fedify';
import type { Actor } from '@fedify/fedify';
import type { AccountService } from 'account/account.service';
import type { Account } from 'account/types';
import type { Site } from 'account/types';
import {
    getFollowerCount,
    getFollowingCount,
    isFollowedByDefaultSiteAccount,
} from 'helpers/activitypub/actor';
import { getAttachments } from 'helpers/activitypub/actor';
import { lookupObject } from 'lookup-helpers';
import { describe, expect, it, vi } from 'vitest';
import { AP_BASE_PATH } from '../../../constants';
import {
    getAccountDTOByHandle,
    getAccountDtoFromAccount,
    isInternalAccount,
} from './account';

vi.mock('../../../lookup-helpers', () => ({
    lookupObject: vi.fn(),
}));

vi.mock('helpers/activitypub/actor', async () => {
    const actual = await vi.importActual('helpers/activitypub/actor');
    return {
        ...actual,
        getFollowerCount: vi.fn(),
        getFollowingCount: vi.fn(),
        isFollowedByDefaultSiteAccount: vi.fn(),
        getAttachments: vi.fn(),
    };
});

vi.mock('@fedify/fedify', async () => {
    const actual = await vi.importActual('@fedify/fedify');
    return {
        ...actual,
        isActor: vi.fn().mockImplementation((obj) => obj?.isActor?.() ?? false),
    };
});

describe('Account Helpers', () => {
    describe('isInternalAccount', () => {
        it('should return true for internal account', () => {
            const account = {
                ap_id: new URL(
                    `https://example.com/${AP_BASE_PATH}/accounts/123`,
                ).toString(),
            } as Account;

            expect(isInternalAccount(account)).toBe(true);
        });

        it('should return false for external account', () => {
            const account = {
                ap_id: new URL('https://other.com/accounts/123').toString(),
            } as Account;

            expect(isInternalAccount(account)).toBe(false);
        });
    });

    describe('getAccountDtoFromAccount', () => {
        it('should convert Account to AccountDTO with all fields', async () => {
            const account = {
                id: 123,
                name: 'Test User',
                username: 'testuser',
                bio: 'Test bio',
                avatar_url: 'https://example.com/avatar.jpg',
                banner_image_url: 'https://example.com/banner.jpg',
                url: 'https://example.com/profile',
                ap_id: new URL(
                    `https://example.com/${AP_BASE_PATH}/accounts/123`,
                ).toString(),
            } as Account;

            const defaultAccount = {
                id: 456,
                ap_id: new URL(
                    `https://example.com/${AP_BASE_PATH}/accounts/456`,
                ).toString(),
            } as Account;

            const accountService = {
                getPostCount: vi.fn().mockResolvedValue(10),
                getLikedCount: vi.fn().mockResolvedValue(5),
                getFollowingAccountsCount: vi.fn().mockResolvedValue(20),
                getFollowerAccountsCount: vi.fn().mockResolvedValue(15),
                checkIfAccountIsFollowing: vi.fn().mockResolvedValue(true),
            };

            const dto = await getAccountDtoFromAccount(
                account,
                defaultAccount,
                accountService as unknown as AccountService,
            );

            expect(dto).toEqual({
                id: '123',
                name: 'Test User',
                handle: '@testuser@example.com',
                bio: 'Test bio',
                url: 'https://example.com/profile',
                avatarUrl: 'https://example.com/avatar.jpg',
                bannerImageUrl: 'https://example.com/banner.jpg',
                customFields: {},
                attachment: [],
                postCount: 10,
                likedCount: 5,
                followingCount: 20,
                followerCount: 15,
                followedByMe: true,
                followsMe: false,
            });
        });

        it('should handle missing optional fields', async () => {
            const account = {
                id: 123,
                username: 'testuser',
                ap_id: new URL(
                    `https://example.com/${AP_BASE_PATH}/accounts/123`,
                ).toString(),
            } as Account;

            const defaultAccount = {
                id: 456,
                ap_id: new URL(
                    `https://example.com/${AP_BASE_PATH}/accounts/456`,
                ).toString(),
            } as Account;

            const accountService = {
                getPostCount: vi.fn().mockResolvedValue(0),
                getLikedCount: vi.fn().mockResolvedValue(0),
                getFollowingAccountsCount: vi.fn().mockResolvedValue(0),
                getFollowerAccountsCount: vi.fn().mockResolvedValue(0),
                checkIfAccountIsFollowing: vi.fn().mockResolvedValue(false),
            };

            const dto = await getAccountDtoFromAccount(
                account,
                defaultAccount,
                accountService as unknown as AccountService,
            );

            expect(dto).toEqual({
                id: '123',
                name: '',
                handle: '@testuser@example.com',
                bio: '',
                url: '',
                avatarUrl: '',
                bannerImageUrl: '',
                customFields: {},
                attachment: [],
                postCount: 0,
                likedCount: 0,
                followingCount: 0,
                followerCount: 0,
                followedByMe: false,
                followsMe: false,
            });
        });
    });

    describe('getAccountDTOByHandle', () => {
        it('should return AccountDTO for valid handle', async () => {
            const mockActor = {
                id: new URL('https://example.com/accounts/123'),
                name: 'Test User',
                summary: 'Test bio',
                url: 'https://example.com/profile',
                icon: { url: new URL('https://example.com/avatar.jpg') },
                image: { url: new URL('https://example.com/banner.jpg') },
                preferredUsername: 'test',
                toJsonLd: vi.fn().mockResolvedValue({
                    id: 'https://example.com/accounts/123',
                    name: 'Test User',
                    summary: 'Test bio',
                    url: 'https://example.com/profile',
                    icon: { url: 'https://example.com/avatar.jpg' },
                    image: { url: 'https://example.com/banner.jpg' },
                }),
                isActor: () => true,
            } as unknown as Actor;

            (
                lookupObject as unknown as ReturnType<typeof vi.fn>
            ).mockResolvedValue(mockActor);
            (
                getFollowerCount as unknown as ReturnType<typeof vi.fn>
            ).mockResolvedValue(10);
            (
                getFollowingCount as unknown as ReturnType<typeof vi.fn>
            ).mockResolvedValue(5);
            (
                isFollowedByDefaultSiteAccount as unknown as ReturnType<
                    typeof vi.fn
                >
            ).mockResolvedValue(true);
            (
                getAttachments as unknown as ReturnType<typeof vi.fn>
            ).mockResolvedValue([]);

            const apCtx = {} as Context<any>;
            const site = {} as Site;
            const accountService = {
                checkIfAccountIsFollowing: vi.fn().mockResolvedValue(true),
            };

            const dto = await getAccountDTOByHandle(
                '@test@example.com',
                apCtx,
                site,
                accountService as unknown as AccountService,
            );

            expect(dto).toEqual({
                id: new URL('https://example.com/accounts/123').toString(),
                name: 'Test User',
                handle: '@test@example.com',
                bio: 'Test bio',
                url: 'https://example.com/profile',
                avatarUrl: 'https://example.com/avatar.jpg',
                bannerImageUrl: 'https://example.com/banner.jpg',
                customFields: {},
                postCount: 0,
                likedCount: 0,
                followingCount: 5,
                followerCount: 10,
                followedByMe: true,
                followsMe: false,
                attachment: [],
            });
        });

        it('should throw error for empty handle', async () => {
            const apCtx = {} as Context<any>;
            const site = {} as Site;
            const accountService = {} as any;

            await expect(
                getAccountDTOByHandle('', apCtx, site, accountService),
            ).rejects.toThrow('Handle is null');
        });

        it('should throw error when actor not found', async () => {
            (
                lookupObject as unknown as ReturnType<typeof vi.fn>
            ).mockResolvedValue(null);

            const apCtx = {} as Context<any>;
            const site = {} as Site;
            const accountService = {} as any;

            await expect(
                getAccountDTOByHandle(
                    'nonexistent@example.com',
                    apCtx,
                    site,
                    accountService,
                ),
            ).rejects.toThrow('Actor not found');
        });
    });
});
