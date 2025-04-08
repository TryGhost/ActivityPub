import type { Context } from '@fedify/fedify';
import type { Actor } from '@fedify/fedify';
import { Account } from 'account/account.entity';
import type { AccountService } from 'account/account.service';
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
import { getAccountDTOByHandle, getAccountDTOFromAccount } from './account';

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
    describe('getAccountDTOFromAccount', () => {
        it('should convert Account to AccountDTO with all fields', async () => {
            const accountData = {
                id: 123,
                uuid: 'test-uuid',
                username: 'testuser',
                name: '',
                bio: '',
                avatarUrl: new URL('https://example.com/avatar.jpg'),
                bannerImageUrl: new URL('https://example.com/banner.jpg'),
                site: {
                    id: 1,
                    host: 'example.com',
                    webhook_secret: 'test-secret',
                },
                apId: new URL(
                    `https://example.com/${AP_BASE_PATH}/accounts/123`,
                ),
                url: new URL('https://example.com/profile'),
                apFollowers: new URL('https://example.com/followers'),
                postCount: 0,
                repostCount: 0,
                likedPostCount: 0,
                followerCount: 0,
                followingCount: 0,
            };

            const defaultAccountData = {
                id: 456,
                uuid: 'default-uuid',
                username: 'default',
                name: '',
                bio: '',
                avatarUrl: new URL('https://example.com/avatar.jpg'),
                bannerImageUrl: new URL('https://example.com/banner.jpg'),
                site: {
                    id: 1,
                    host: 'example.com',
                    webhook_secret: 'test-secret',
                },
                apId: new URL(
                    `https://example.com/${AP_BASE_PATH}/accounts/456`,
                ),
                url: new URL('https://example.com/profile'),
                apFollowers: new URL('https://example.com/followers'),
                postCount: 0,
                repostCount: 0,
                likedPostCount: 0,
                followerCount: 0,
                followingCount: 0,
            };

            const account = Account.createFromData(accountData);
            const defaultAccount = Account.createFromData(defaultAccountData);

            const accountService = {
                getPostCount: vi.fn().mockResolvedValue(10),
                getLikedCount: vi.fn().mockResolvedValue(5),
                getFollowingAccountsCount: vi.fn().mockResolvedValue(20),
                getFollowerAccountsCount: vi.fn().mockResolvedValue(15),
                checkIfAccountIsFollowing: vi.fn().mockResolvedValue(true),
            };

            const dto = await getAccountDTOFromAccount(
                account as Account,
                defaultAccount,
                accountService as unknown as AccountService,
            );

            expect(dto).toEqual({
                id: '123',
                name: '',
                handle: '@testuser@example.com',
                bio: '',
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
            const accountData = {
                id: 123,
                uuid: 'test-uuid',
                username: 'testuser',
                name: null,
                bio: null,
                avatarUrl: null,
                bannerImageUrl: null,
                site: {
                    id: 1,
                    host: 'example.com',
                    webhook_secret: 'test-secret',
                },
                apId: new URL(
                    `https://example.com/${AP_BASE_PATH}/accounts/123`,
                ),
                url: null,
                apFollowers: new URL('https://example.com/followers'),
                postCount: 0,
                repostCount: 0,
                likedPostCount: 0,
                followerCount: 0,
                followingCount: 0,
            };

            const account = Account.createFromData(accountData);

            const defaultAccountData = {
                id: 456,
                uuid: 'default-uuid',
                username: 'default',
                name: null,
                bio: null,
                avatarUrl: null,
                bannerImageUrl: null,
                site: {
                    id: 1,
                    host: 'example.com',
                    webhook_secret: 'test-secret',
                },
                apId: new URL(
                    `https://example.com/${AP_BASE_PATH}/accounts/456`,
                ),
                url: null,
                apFollowers: new URL('https://example.com/followers'),
                postCount: 0,
                repostCount: 0,
                likedPostCount: 0,
                followerCount: 0,
                followingCount: 0,
            };

            const defaultAccount = Account.createFromData(defaultAccountData);

            const accountService = {
                getPostCount: vi.fn().mockResolvedValue(0),
                getLikedCount: vi.fn().mockResolvedValue(0),
                getFollowingAccountsCount: vi.fn().mockResolvedValue(0),
                getFollowerAccountsCount: vi.fn().mockResolvedValue(0),
                checkIfAccountIsFollowing: vi.fn().mockResolvedValue(false),
            };

            const dto = await getAccountDTOFromAccount(
                account as Account,
                defaultAccount,
                accountService as unknown as AccountService,
            );

            expect(dto).toEqual({
                id: '123',
                name: '',
                handle: '@testuser@example.com',
                bio: '',
                url: 'https://example.com//.ghost/activitypub/accounts/123',
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
