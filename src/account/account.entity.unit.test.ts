import { describe, expect, it } from 'vitest';

import { AccountEntity } from '@/account/account.entity';
import {
    AccountBlockedEvent,
    AccountCreatedEvent,
    AccountFollowedEvent,
    AccountUnblockedEvent,
    AccountUnfollowedEvent,
    AccountUpdatedEvent,
    DomainBlockedEvent,
    DomainUnblockedEvent,
    NotificationsReadEvent,
} from '@/account/events';
import { PostType } from '@/post/post.entity';
import {
    createInternalAccountDraftData,
    createTestInternalAccount,
} from '@/test/account-entity-test-helpers';

describe('AccountEntity', () => {
    it('Uses the apId if the url is missing', async () => {
        const account = await createTestInternalAccount(1, {
            host: new URL('http://foobar.com'),
            username: 'foobar',
            name: 'Foo Bar',
            bio: 'Just a foobar',
            url: null,
            avatarUrl: new URL('http://foobar.com/avatar/foobar.png'),
            bannerImageUrl: new URL('http://foobar.com/banner/foobar.png'),
            customFields: null,
        });

        expect(account.url).toEqual(account.apId);
    });

    it('Can generate the apId', async () => {
        const account = await createTestInternalAccount(1, {
            host: new URL('http://foobar.com'),
            username: 'foobar',
            name: 'Foo Bar',
            bio: 'Just a foobar',
            url: null,
            avatarUrl: new URL('http://foobar.com/avatar/foobar.png'),
            bannerImageUrl: new URL('http://foobar.com/banner/foobar.png'),
            customFields: {
                foo: 'bar',
            },
        });

        expect(account.apId.href).toBe(
            'http://foobar.com/.ghost/activitypub/users/index',
        );
        expect(account.url).toEqual(account.apId);
    });

    it('Can generate the apFollowers', async () => {
        const account = await createTestInternalAccount(1, {
            host: new URL('http://foobar.com'),
            username: 'foobar',
            name: 'Foo Bar',
            bio: 'Just a foobar',
            url: null,
            avatarUrl: new URL('http://foobar.com/avatar/foobar.png'),
            bannerImageUrl: new URL('http://foobar.com/banner/foobar.png'),
            customFields: null,
        });

        expect(account.apFollowers?.href).toBe(
            'http://foobar.com/.ghost/activitypub/followers/index',
        );
    });

    describe('fromDraft', () => {
        it('should create an AccountEntity from a draft with correct properties', async () => {
            const draftData = await createInternalAccountDraftData({
                host: new URL('http://example.com'),
                username: 'testuser',
                name: 'Test User',
                bio: 'A test user bio',
                url: new URL('http://example.com/user'),
                avatarUrl: new URL('http://example.com/avatar.png'),
                bannerImageUrl: new URL('http://example.com/banner.png'),
                customFields: null,
            });

            const draft = AccountEntity.draft(draftData);
            const id = 42;
            const account = AccountEntity.fromDraft(draft, id);

            expect(account).toBeInstanceOf(AccountEntity);
            expect(account.id).toBe(id);
            expect(account.uuid).toBe(draft.uuid);
            expect(account.username).toBe(draft.username);
            expect(account.name).toBe(draft.name);
            expect(account.bio).toBe(draft.bio);
            expect(account.url).toEqual(draft.url);
            expect(account.avatarUrl).toEqual(draft.avatarUrl);
            expect(account.bannerImageUrl).toEqual(draft.bannerImageUrl);
            expect(account.apId).toEqual(draft.apId);
            expect(account.apFollowers).toEqual(draft.apFollowers);
            expect(account.apInbox).toEqual(draft.apInbox);
            expect(account.isInternal).toBe(draft.isInternal);
        });

        it('should create an AccountEntity with AccountCreatedEvent', async () => {
            const draftData = await createInternalAccountDraftData({
                host: new URL('http://example.com'),
                username: 'testuser',
                name: 'Test User',
                bio: 'A test user bio',
                url: new URL('http://example.com/user'),
                avatarUrl: new URL('http://example.com/avatar.png'),
                bannerImageUrl: new URL('http://example.com/banner.png'),
                customFields: null,
            });

            const draft = AccountEntity.draft(draftData);
            const account = AccountEntity.fromDraft(draft, 123);

            const events = AccountEntity.pullEvents(account);
            expect(events).toHaveLength(1);
            expect(events[0]).toBeInstanceOf(AccountCreatedEvent);
        });

        it('should handle null values correctly', async () => {
            const draftData = await createInternalAccountDraftData({
                host: new URL('http://example.com'),
                username: 'testuser',
                name: 'Test User',
                bio: null,
                url: null,
                avatarUrl: null,
                bannerImageUrl: null,
                customFields: null,
            });

            const draft = AccountEntity.draft(draftData);
            const account = AccountEntity.fromDraft(draft, 999);

            expect(account.bio).toBeNull();
            expect(account.avatarUrl).toBeNull();
            expect(account.bannerImageUrl).toBeNull();
            // URL should be set to apId when null
            expect(account.url).toEqual(account.apId);
        });
    });

    describe('getApIdForPost', () => {
        it('Can get the ap id for an article', async () => {
            const account = await createTestInternalAccount(1, {
                host: new URL('http://foobar.com'),
                username: 'foobar',
                name: 'Foo Bar',
                bio: 'Just a foobar',
                url: null,
                avatarUrl: new URL('http://foobar.com/avatar/foobar.png'),
                bannerImageUrl: new URL('http://foobar.com/banner/foobar.png'),
                customFields: null,
            });

            const postApId = account.getApIdForPost({
                type: PostType.Article,
                uuid: '123',
            });

            expect(postApId.href).toBe(
                'http://foobar.com/.ghost/activitypub/article/123',
            );
        });

        it('Can get the ap id for a note', async () => {
            const account = await createTestInternalAccount(1, {
                host: new URL('http://foobar.com'),
                username: 'foobar',
                name: 'Foo Bar',
                bio: 'Just a foobar',
                url: null,
                avatarUrl: new URL('http://foobar.com/avatar/foobar.png'),
                bannerImageUrl: new URL('http://foobar.com/banner/foobar.png'),
                customFields: null,
            });

            const postApId = account.getApIdForPost({
                type: PostType.Note,
                uuid: '123',
            });

            expect(postApId.href).toBe(
                'http://foobar.com/.ghost/activitypub/note/123',
            );
        });
    });

    describe('updateProfile', () => {
        it('can update name', async () => {
            const account = await createTestInternalAccount(1, {
                host: new URL('http://example.com'),
                username: 'testuser',
                name: 'Original Name',
                bio: 'Original Bio',
                url: new URL('http://example.com/url'),
                avatarUrl: new URL('http://example.com/original-avatar.png'),
                bannerImageUrl: new URL(
                    'http://example.com/original-banner.png',
                ),
                customFields: null,
            });

            const updated = account.updateProfile({ name: 'Updated Name' });

            expect(updated.name).toBe('Updated Name');
            expect(updated.bio).toBe('Original Bio');
            expect(updated.username).toBe('testuser');
            expect(updated.avatarUrl?.href).toBe(
                'http://example.com/original-avatar.png',
            );
            expect(updated.bannerImageUrl?.href).toBe(
                'http://example.com/original-banner.png',
            );
        });

        it('can update bio', async () => {
            const account = await createTestInternalAccount(1, {
                host: new URL('http://example.com'),
                username: 'testuser',
                name: 'Original Name',
                bio: 'Original Bio',
                url: new URL('http://example.com/url'),
                avatarUrl: new URL('http://example.com/original-avatar.png'),
                bannerImageUrl: new URL(
                    'http://example.com/original-banner.png',
                ),
                customFields: null,
            });

            const updated = account.updateProfile({ bio: 'Updated Bio' });

            expect(updated.name).toBe('Original Name');
            expect(updated.bio).toBe('Updated Bio');
            expect(updated.username).toBe('testuser');
            expect(updated.avatarUrl?.href).toBe(
                'http://example.com/original-avatar.png',
            );
            expect(updated.bannerImageUrl?.href).toBe(
                'http://example.com/original-banner.png',
            );
        });

        it('can update username', async () => {
            const account = await createTestInternalAccount(1, {
                host: new URL('http://example.com'),
                username: 'testuser',
                name: 'Original Name',
                bio: 'Original Bio',
                url: new URL('http://example.com/url'),
                avatarUrl: new URL('http://example.com/original-avatar.png'),
                bannerImageUrl: new URL(
                    'http://example.com/original-banner.png',
                ),
                customFields: null,
            });

            const updated = account.updateProfile({
                username: 'updatedtestuser',
            });

            expect(updated.name).toBe('Original Name');
            expect(updated.bio).toBe('Original Bio');
            expect(updated.username).toBe('updatedtestuser');
            expect(updated.avatarUrl?.href).toBe(
                'http://example.com/original-avatar.png',
            );
            expect(updated.bannerImageUrl?.href).toBe(
                'http://example.com/original-banner.png',
            );
        });

        it('can update avatarUrl', async () => {
            const account = await createTestInternalAccount(1, {
                host: new URL('http://example.com'),
                username: 'testuser',
                name: 'Original Name',
                bio: 'Original Bio',
                url: new URL('http://example.com/url'),
                avatarUrl: new URL('http://example.com/original-avatar.png'),
                bannerImageUrl: new URL(
                    'http://example.com/original-banner.png',
                ),
                customFields: null,
            });

            const updated = account.updateProfile({
                avatarUrl: new URL('http://example.com/updated-avatar.png'),
            });

            expect(updated.name).toBe('Original Name');
            expect(updated.bio).toBe('Original Bio');
            expect(updated.username).toBe('testuser');
            expect(updated.avatarUrl?.href).toBe(
                'http://example.com/updated-avatar.png',
            );
            expect(updated.bannerImageUrl?.href).toBe(
                'http://example.com/original-banner.png',
            );
        });

        it('can update bannerImageUrl', async () => {
            const account = await createTestInternalAccount(1, {
                host: new URL('http://example.com'),
                username: 'testuser',
                name: 'Original Name',
                bio: 'Original Bio',
                url: new URL('http://example.com/url'),
                avatarUrl: new URL('http://example.com/original-avatar.png'),
                bannerImageUrl: new URL(
                    'http://example.com/original-banner.png',
                ),
                customFields: null,
            });

            const updated = account.updateProfile({
                bannerImageUrl: new URL(
                    'http://example.com/updated-banner.png',
                ),
            });

            expect(updated.name).toBe('Original Name');
            expect(updated.bio).toBe('Original Bio');
            expect(updated.username).toBe('testuser');
            expect(updated.avatarUrl?.href).toBe(
                'http://example.com/original-avatar.png',
            );
            expect(updated.bannerImageUrl?.href).toBe(
                'http://example.com/updated-banner.png',
            );
        });

        it('can update url', async () => {
            const account = await createTestInternalAccount(1, {
                host: new URL('http://example.com'),
                username: 'testuser',
                name: 'Original Name',
                bio: 'Original Bio',
                url: new URL('http://example.com/url'),
                avatarUrl: new URL('http://example.com/original-avatar.png'),
                bannerImageUrl: new URL(
                    'http://example.com/original-banner.png',
                ),
                customFields: null,
            });

            const updated = account.updateProfile({
                url: new URL('http://example.com/updated-url'),
            });

            expect(updated.name).toBe('Original Name');
            expect(updated.bio).toBe('Original Bio');
            expect(updated.username).toBe('testuser');
            expect(updated.avatarUrl?.href).toBe(
                'http://example.com/original-avatar.png',
            );
            expect(updated.bannerImageUrl?.href).toBe(
                'http://example.com/original-banner.png',
            );
            expect(updated.url?.href).toBe('http://example.com/updated-url');
        });

        it('can update multiple properties at once', async () => {
            const account = await createTestInternalAccount(1, {
                host: new URL('http://example.com'),
                username: 'testuser',
                name: 'Original Name',
                bio: 'Original Bio',
                url: new URL('http://example.com/url'),
                avatarUrl: new URL('http://example.com/original-avatar.png'),
                bannerImageUrl: new URL(
                    'http://example.com/original-banner.png',
                ),
                customFields: null,
            });

            const updated = account.updateProfile({
                name: 'Updated Name',
                bio: 'Updated Bio',
                username: 'updatedtestuser',
                avatarUrl: new URL('http://example.com/updated-avatar.png'),
                bannerImageUrl: new URL(
                    'http://example.com/updated-banner.png',
                ),
                url: new URL('http://example.com/updated-url'),
                customFields: {
                    foo: 'bar',
                },
            });

            expect(updated.name).toBe('Updated Name');
            expect(updated.bio).toBe('Updated Bio');
            expect(updated.username).toBe('updatedtestuser');
            expect(updated.avatarUrl?.href).toBe(
                'http://example.com/updated-avatar.png',
            );
            expect(updated.bannerImageUrl?.href).toBe(
                'http://example.com/updated-banner.png',
            );
            expect(updated.url?.href).toBe('http://example.com/updated-url');
            expect(updated.customFields).toEqual({
                foo: 'bar',
            });
        });

        it('can set values to null', async () => {
            const account = await createTestInternalAccount(1, {
                host: new URL('http://example.com'),
                username: 'testuser',
                name: 'Original Name',
                bio: 'Original Bio',
                url: new URL('http://example.com/url'),
                avatarUrl: new URL('http://example.com/original-avatar.png'),
                bannerImageUrl: new URL(
                    'http://example.com/original-banner.png',
                ),
                customFields: {
                    foo: 'bar',
                },
            });

            const updated = account.updateProfile({
                bio: null,
                avatarUrl: null,
                customFields: null,
            });

            expect(updated.name).toBe('Original Name');
            expect(updated.bio).toBeNull();
            expect(updated.username).toBe('testuser');
            expect(updated.avatarUrl).toBeNull();
            expect(updated.bannerImageUrl?.href).toBe(
                'http://example.com/original-banner.png',
            );
            expect(updated.customFields).toBeNull();
        });

        it('should emit AccountUpdatedEvent when data changes', async () => {
            const account = await createTestInternalAccount(1, {
                host: new URL('http://example.com'),
                username: 'testuser',
                name: 'Original Name',
                bio: 'Original Bio',
                url: new URL('http://example.com/url'),
                avatarUrl: new URL('http://example.com/original-avatar.png'),
                bannerImageUrl: new URL(
                    'http://example.com/original-banner.png',
                ),
                customFields: null,
            });

            const updated = account.updateProfile({
                name: 'Updated Name',
            });

            const events = AccountEntity.pullEvents(updated);
            expect(events).toHaveLength(1);
            expect(events[0]).toBeInstanceOf(AccountUpdatedEvent);
        });

        it('should not emit AccountUpdatedEvent when data is the same', async () => {
            const account = await createTestInternalAccount(1, {
                host: new URL('http://example.com'),
                username: 'testuser',
                name: 'Original Name',
                bio: 'Original Bio',
                url: new URL('http://example.com/url'),
                avatarUrl: new URL('http://example.com/original-avatar.png'),
                bannerImageUrl: new URL(
                    'http://example.com/original-banner.png',
                ),
                customFields: null,
            });

            const updated = account.updateProfile({
                name: 'Original Name',
                bio: 'Original Bio',
                username: 'testuser',
                avatarUrl: new URL('http://example.com/original-avatar.png'),
                bannerImageUrl: new URL(
                    'http://example.com/original-banner.png',
                ),
            });

            const events = AccountEntity.pullEvents(updated);
            expect(events).toHaveLength(0);
        });
    });

    describe('block and unblock', () => {
        it('You cannot block yourself', async () => {
            const account = await createTestInternalAccount(1, {
                host: new URL('http://example.com'),
                username: 'testuser',
                name: 'Original Name',
                bio: 'Original Bio',
                url: new URL('http://example.com/url'),
                avatarUrl: new URL('http://example.com/original-avatar.png'),
                bannerImageUrl: new URL(
                    'http://example.com/original-banner.png',
                ),
                customFields: null,
            });

            const updated = account.block(account);

            expect(AccountEntity.pullEvents(updated)).toStrictEqual([]);
        });

        it('You can block another account', async () => {
            const account = await createTestInternalAccount(1, {
                host: new URL('http://example.com'),
                username: 'testuser',
                name: 'Original Name',
                bio: 'Original Bio',
                url: new URL('http://example.com/url'),
                avatarUrl: new URL('http://example.com/original-avatar.png'),
                bannerImageUrl: new URL(
                    'http://example.com/original-banner.png',
                ),
                customFields: null,
            });
            const accountToBlock = await createTestInternalAccount(2, {
                host: new URL('http://example.com'),
                username: 'testuser2',
                name: 'Original Name 2',
                bio: 'Original Bio',
                url: new URL('http://example.com/url'),
                avatarUrl: new URL('http://example.com/original-avatar.png'),
                bannerImageUrl: new URL(
                    'http://example.com/original-banner.png',
                ),
                customFields: null,
            });

            const updated = account.block(accountToBlock);

            expect(AccountEntity.pullEvents(updated)).toStrictEqual([
                new AccountBlockedEvent(accountToBlock.id, account.id),
            ]);
        });

        it('You cannot unblock yourself', async () => {
            const account = await createTestInternalAccount(1, {
                host: new URL('http://example.com'),
                username: 'testuser',
                name: 'Original Name',
                bio: 'Original Bio',
                url: new URL('http://example.com/url'),
                avatarUrl: new URL('http://example.com/original-avatar.png'),
                bannerImageUrl: new URL(
                    'http://example.com/original-banner.png',
                ),
                customFields: null,
            });

            const updated = account.unblock(account);

            expect(AccountEntity.pullEvents(updated)).toStrictEqual([]);
        });

        it('You can unblock another account', async () => {
            const account = await createTestInternalAccount(1, {
                host: new URL('http://example.com'),
                username: 'testuser',
                name: 'Original Name',
                bio: 'Original Bio',
                url: new URL('http://example.com/url'),
                avatarUrl: new URL('http://example.com/original-avatar.png'),
                bannerImageUrl: new URL(
                    'http://example.com/original-banner.png',
                ),
                customFields: null,
            });
            const accountToUnblock = await createTestInternalAccount(2, {
                host: new URL('http://example.com'),
                username: 'testuser2',
                name: 'Original Name 2',
                bio: 'Original Bio',
                url: new URL('http://example.com/url'),
                avatarUrl: new URL('http://example.com/original-avatar.png'),
                bannerImageUrl: new URL(
                    'http://example.com/original-banner.png',
                ),
                customFields: null,
            });

            const updated = account.unblock(accountToUnblock);

            expect(AccountEntity.pullEvents(updated)).toStrictEqual([
                new AccountUnblockedEvent(accountToUnblock.id, account.id),
            ]);
        });
    });

    describe('blockDomain and unblockDomain', () => {
        it('should block domain', async () => {
            const account = await createTestInternalAccount(1, {
                host: new URL('http://example.com'),
                username: 'testuser',
                name: 'Original Name',
                bio: 'Original Bio',
                url: new URL('http://example.com/url'),
                avatarUrl: new URL('http://example.com/original-avatar.png'),
                bannerImageUrl: new URL(
                    'http://example.com/original-banner.png',
                ),
                customFields: null,
            });

            const domainUrl = new URL('https://example.org');
            const result = account.blockDomain(domainUrl);
            const events = AccountEntity.pullEvents(result);

            expect(events.length).toBe(1);
            expect(events[0]).toBeInstanceOf(DomainBlockedEvent);

            if (events[0] instanceof DomainBlockedEvent) {
                expect(events[0].getDomain()).toEqual(domainUrl);
                expect(events[0].getBlockerId()).toBe(account.id);
            }
        });

        it('should unblock domain', async () => {
            const account = await createTestInternalAccount(1, {
                host: new URL('http://example.com'),
                username: 'testuser',
                name: 'Original Name',
                bio: 'Original Bio',
                url: new URL('http://example.com/url'),
                avatarUrl: new URL('http://example.com/original-avatar.png'),
                bannerImageUrl: new URL(
                    'http://example.com/original-banner.png',
                ),
                customFields: null,
            });

            const domainUrl = new URL('https://example.org');
            const result = account.unblockDomain(domainUrl);
            const events = AccountEntity.pullEvents(result);

            expect(events.length).toBe(1);
            expect(events[0]).toBeInstanceOf(DomainUnblockedEvent);

            if (events[0] instanceof DomainUnblockedEvent) {
                expect(events[0].getDomain()).toEqual(domainUrl);
                expect(events[0].getUnblockerId()).toBe(account.id);
            }
        });
    });

    describe('follow and unfollow', () => {
        it('You cannot follow yourself', async () => {
            const account = await createTestInternalAccount(1, {
                host: new URL('http://example.com'),
                username: 'testuser',
                name: 'Original Name',
                bio: 'Original Bio',
                url: new URL('http://example.com/url'),
                avatarUrl: new URL('http://example.com/original-avatar.png'),
                bannerImageUrl: new URL(
                    'http://example.com/original-banner.png',
                ),
                customFields: null,
            });

            const updated = account.follow(account);

            expect(AccountEntity.pullEvents(updated)).toStrictEqual([]);
        });

        it('You can follow another account', async () => {
            const account = await createTestInternalAccount(1, {
                host: new URL('http://example.com'),
                username: 'testuser',
                name: 'Original Name',
                bio: 'Original Bio',
                url: new URL('http://example.com/url'),
                avatarUrl: new URL('http://example.com/original-avatar.png'),
                bannerImageUrl: new URL(
                    'http://example.com/original-banner.png',
                ),
                customFields: null,
            });
            const accountToFollow = await createTestInternalAccount(2, {
                host: new URL('http://example.com'),
                username: 'testuser2',
                name: 'Original Name 2',
                bio: 'Original Bio',
                url: new URL('http://example.com/url'),
                avatarUrl: new URL('http://example.com/original-avatar.png'),
                bannerImageUrl: new URL(
                    'http://example.com/original-banner.png',
                ),
                customFields: null,
            });

            const updated = account.follow(accountToFollow);

            expect(AccountEntity.pullEvents(updated)).toStrictEqual([
                new AccountFollowedEvent(accountToFollow.id, account.id),
            ]);
        });

        it('You cannot unfollow yourself', async () => {
            const account = await createTestInternalAccount(1, {
                host: new URL('http://example.com'),
                username: 'testuser',
                name: 'Original Name',
                bio: 'Original Bio',
                url: new URL('http://example.com/url'),
                avatarUrl: new URL('http://example.com/original-avatar.png'),
                bannerImageUrl: new URL(
                    'http://example.com/original-banner.png',
                ),
                customFields: null,
            });

            const updated = account.unfollow(account);

            expect(AccountEntity.pullEvents(updated)).toStrictEqual([]);
        });

        it('You can unfollow another account', async () => {
            const account = await createTestInternalAccount(1, {
                host: new URL('http://example.com'),
                username: 'testuser',
                name: 'Original Name',
                bio: 'Original Bio',
                url: new URL('http://example.com/url'),
                avatarUrl: new URL('http://example.com/original-avatar.png'),
                bannerImageUrl: new URL(
                    'http://example.com/original-banner.png',
                ),
                customFields: null,
            });
            const accountToUnfollow = await createTestInternalAccount(2, {
                host: new URL('http://example.com'),
                username: 'testuser2',
                name: 'Original Name 2',
                bio: 'Original Bio',
                url: new URL('http://example.com/url'),
                avatarUrl: new URL('http://example.com/original-avatar.png'),
                bannerImageUrl: new URL(
                    'http://example.com/original-banner.png',
                ),
                customFields: null,
            });

            const updated = account.unfollow(accountToUnfollow);

            expect(AccountEntity.pullEvents(updated)).toStrictEqual([
                new AccountUnfollowedEvent(accountToUnfollow.id, account.id),
            ]);
        });
    });

    describe('readAllNotifications', () => {
        it('should read all notifications', async () => {
            const account = await createTestInternalAccount(1, {
                host: new URL('http://example.com'),
                username: 'testuser',
                name: 'Original Name',
                bio: 'Original Bio',
                url: new URL('http://example.com/url'),
                avatarUrl: new URL('http://example.com/original-avatar.png'),
                bannerImageUrl: new URL(
                    'http://example.com/original-banner.png',
                ),
                customFields: null,
            });

            const result = account.readAllNotifications();
            const events = AccountEntity.pullEvents(result);
            expect(events).toStrictEqual([
                new NotificationsReadEvent(account.id),
            ]);
        });
    });
});
