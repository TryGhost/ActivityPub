import { describe, expect, it } from 'vitest';

import { AccountEntity } from 'account/account.entity';
import { PostType } from 'post/post.entity';
import { AccountBlockedEvent } from './account-blocked.event';

describe('AccountEntity', () => {
    it('Uses the apId if the url is missing', () => {
        const draft = AccountEntity.draft({
            isInternal: true,
            host: new URL('http://foobar.com'),
            username: 'foobar',
            name: 'Foo Bar',
            bio: 'Just a foobar',
            url: null,
            avatarUrl: new URL('http://foobar.com/avatar/foobar.png'),
            bannerImageUrl: new URL('http://foobar.com/banner/foobar.png'),
        });

        const account = AccountEntity.create({
            id: 1,
            ...draft,
        });

        expect(account.url).toEqual(account.apId);
    });

    it('Can generate the apId', () => {
        const draft = AccountEntity.draft({
            isInternal: true,
            host: new URL('http://foobar.com'),
            username: 'foobar',
            name: 'Foo Bar',
            bio: 'Just a foobar',
            url: null,
            avatarUrl: new URL('http://foobar.com/avatar/foobar.png'),
            bannerImageUrl: new URL('http://foobar.com/banner/foobar.png'),
        });

        const account = AccountEntity.create({
            id: 1,
            ...draft,
        });

        expect(account.apId.href).toBe(
            'http://foobar.com/.ghost/activitypub/users/index',
        );
        expect(account.url).toEqual(account.apId);
    });

    it('Can generate the apFollowers', () => {
        const draft = AccountEntity.draft({
            isInternal: true,
            host: new URL('http://foobar.com'),
            username: 'foobar',
            name: 'Foo Bar',
            bio: 'Just a foobar',
            url: null,
            avatarUrl: new URL('http://foobar.com/avatar/foobar.png'),
            bannerImageUrl: new URL('http://foobar.com/banner/foobar.png'),
        });

        const account = AccountEntity.create({
            id: 1,
            ...draft,
        });

        expect(account.apFollowers?.href).toBe(
            'http://foobar.com/.ghost/activitypub/followers/index',
        );
    });

    describe('getApIdForPost', () => {
        it('Can get the ap id for an article', () => {
            const draft = AccountEntity.draft({
                isInternal: true,
                host: new URL('http://foobar.com'),
                username: 'foobar',
                name: 'Foo Bar',
                bio: 'Just a foobar',
                url: null,
                avatarUrl: new URL('http://foobar.com/avatar/foobar.png'),
                bannerImageUrl: new URL('http://foobar.com/banner/foobar.png'),
            });

            const account = AccountEntity.create({
                id: 1,
                ...draft,
            });

            const postApId = account.getApIdForPost({
                type: PostType.Article,
                uuid: '123',
            });

            expect(postApId.href).toBe(
                'http://foobar.com/.ghost/activitypub/article/123',
            );
        });

        it('Can get the ap id for a note', () => {
            const draft = AccountEntity.draft({
                isInternal: true,
                host: new URL('http://foobar.com'),
                username: 'foobar',
                name: 'Foo Bar',
                bio: 'Just a foobar',
                url: null,
                avatarUrl: new URL('http://foobar.com/avatar/foobar.png'),
                bannerImageUrl: new URL('http://foobar.com/banner/foobar.png'),
            });

            const account = AccountEntity.create({
                id: 1,
                ...draft,
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
        it('can update name', () => {
            const draft = AccountEntity.draft({
                isInternal: true,
                host: new URL('http://example.com'),
                username: 'testuser',
                name: 'Original Name',
                bio: 'Original Bio',
                url: new URL('http://example.com/url'),
                avatarUrl: new URL('http://example.com/original-avatar.png'),
                bannerImageUrl: new URL(
                    'http://example.com/original-banner.png',
                ),
            });

            const account = AccountEntity.create({
                id: 1,
                ...draft,
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

        it('can update bio', () => {
            const draft = AccountEntity.draft({
                isInternal: true,
                host: new URL('http://example.com'),
                username: 'testuser',
                name: 'Original Name',
                bio: 'Original Bio',
                url: new URL('http://example.com/url'),
                avatarUrl: new URL('http://example.com/original-avatar.png'),
                bannerImageUrl: new URL(
                    'http://example.com/original-banner.png',
                ),
            });

            const account = AccountEntity.create({
                id: 1,
                ...draft,
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

        it('can update username', () => {
            const draft = AccountEntity.draft({
                isInternal: true,
                host: new URL('http://example.com'),
                username: 'testuser',
                name: 'Original Name',
                bio: 'Original Bio',
                url: new URL('http://example.com/url'),
                avatarUrl: new URL('http://example.com/original-avatar.png'),
                bannerImageUrl: new URL(
                    'http://example.com/original-banner.png',
                ),
            });

            const account = AccountEntity.create({
                id: 1,
                ...draft,
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

        it('can update avatarUrl', () => {
            const draft = AccountEntity.draft({
                isInternal: true,
                host: new URL('http://example.com'),
                username: 'testuser',
                name: 'Original Name',
                bio: 'Original Bio',
                url: new URL('http://example.com/url'),
                avatarUrl: new URL('http://example.com/original-avatar.png'),
                bannerImageUrl: new URL(
                    'http://example.com/original-banner.png',
                ),
            });

            const account = AccountEntity.create({
                id: 1,
                ...draft,
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

        it('can update bannerImageUrl', () => {
            const draft = AccountEntity.draft({
                isInternal: true,
                host: new URL('http://example.com'),
                username: 'testuser',
                name: 'Original Name',
                bio: 'Original Bio',
                url: new URL('http://example.com/url'),
                avatarUrl: new URL('http://example.com/original-avatar.png'),
                bannerImageUrl: new URL(
                    'http://example.com/original-banner.png',
                ),
            });

            const account = AccountEntity.create({
                id: 1,
                ...draft,
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

        it('can update multiple properties at once', () => {
            const draft = AccountEntity.draft({
                isInternal: true,
                host: new URL('http://example.com'),
                username: 'testuser',
                name: 'Original Name',
                bio: 'Original Bio',
                url: new URL('http://example.com/url'),
                avatarUrl: new URL('http://example.com/original-avatar.png'),
                bannerImageUrl: new URL(
                    'http://example.com/original-banner.png',
                ),
            });

            const account = AccountEntity.create({
                id: 1,
                ...draft,
            });

            const updated = account.updateProfile({
                name: 'Updated Name',
                bio: 'Updated Bio',
                username: 'updatedtestuser',
                avatarUrl: new URL('http://example.com/updated-avatar.png'),
                bannerImageUrl: new URL(
                    'http://example.com/updated-banner.png',
                ),
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
        });

        it('can set values to null', () => {
            const draft = AccountEntity.draft({
                isInternal: true,
                host: new URL('http://example.com'),
                username: 'testuser',
                name: 'Original Name',
                bio: 'Original Bio',
                url: new URL('http://example.com/url'),
                avatarUrl: new URL('http://example.com/original-avatar.png'),
                bannerImageUrl: new URL(
                    'http://example.com/original-banner.png',
                ),
            });

            const account = AccountEntity.create({
                id: 1,
                ...draft,
            });

            const updated = account.updateProfile({
                bio: null,
                avatarUrl: null,
            });

            expect(updated.name).toBe('Original Name');
            expect(updated.bio).toBeNull();
            expect(updated.username).toBe('testuser');
            expect(updated.avatarUrl).toBeNull();
            expect(updated.bannerImageUrl?.href).toBe(
                'http://example.com/original-banner.png',
            );
        });
    });
    describe('block', () => {
        it('You cannot block yourself', () => {
            const draft = AccountEntity.draft({
                isInternal: true,
                host: new URL('http://example.com'),
                username: 'testuser',
                name: 'Original Name',
                bio: 'Original Bio',
                url: new URL('http://example.com/url'),
                avatarUrl: new URL('http://example.com/original-avatar.png'),
                bannerImageUrl: new URL(
                    'http://example.com/original-banner.png',
                ),
            });

            const account = AccountEntity.create({
                id: 1,
                ...draft,
            });

            const updated = account.block(account);

            expect(AccountEntity.pullEvents(updated)).toStrictEqual([]);
        });

        it('You can block another account', () => {
            const draft = AccountEntity.draft({
                isInternal: true,
                host: new URL('http://example.com'),
                username: 'testuser',
                name: 'Original Name',
                bio: 'Original Bio',
                url: new URL('http://example.com/url'),
                avatarUrl: new URL('http://example.com/original-avatar.png'),
                bannerImageUrl: new URL(
                    'http://example.com/original-banner.png',
                ),
            });

            const account = AccountEntity.create({
                id: 1,
                ...draft,
            });

            const accountToBlock = AccountEntity.create({
                id: 2,
                ...draft,
            });

            const updated = account.block(accountToBlock);

            expect(AccountEntity.pullEvents(updated)).toStrictEqual([
                new AccountBlockedEvent(accountToBlock.id, account.id),
            ]);
        });
    });
});
