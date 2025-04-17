import { describe, expect, it } from 'vitest';

import { Account } from 'account/account.entity';

describe('Account', () => {
    it('Uses the apId if the url is missing', () => {
        const account = new Account(
            1243,
            null,
            'foobar',
            'Foo Bar',
            'Just a foobar',
            new URL('https://foobar.com/avatar/foobar.png'),
            new URL('https://foobar.com/banner/foobar.png'),
            null,
            new URL('https://foobar.com/user/1234'),
            null,
            new URL('https://foobar.com/followers/1234'),
        );

        expect(account.url).toEqual(account.apId);
    });

    it('Can generate the apId', () => {
        const account = new Account(
            1243,
            null,
            'foobar',
            'Foo Bar',
            'Just a foobar',
            new URL('https://foobar.com/avatar/foobar.png'),
            new URL('https://foobar.com/banner/foobar.png'),
            {
                id: 1,
                host: 'foobar.com',
            },
            null,
            null,
            new URL('https://foobar.com/followers/1234'),
        );

        expect(account.apId.href).toBe(
            'http://foobar.com/.ghost/activitypub/users/foobar',
        );
        expect(account.url).toEqual(account.apId);
    });

    it('Can generate the apFollowers', () => {
        const account = new Account(
            1243,
            null,
            'foobar',
            'Foo Bar',
            'Just a foobar',
            new URL('https://foobar.com/avatar/foobar.png'),
            new URL('https://foobar.com/banner/foobar.png'),
            {
                id: 1,
                host: 'foobar.com',
            },
            new URL('https://foobar.com/user/1234'),
            null,
            null,
        );

        expect(account.apFollowers.href).toBe(
            'http://foobar.com/.ghost/activitypub/followers/foobar',
        );
    });

    describe('updateProfile', () => {
        it('can update name', () => {
            const account = new Account(
                1,
                'test-uuid',
                'testuser',
                'Original Name',
                'Original Bio',
                new URL('https://example.com/original-avatar.png'),
                new URL('https://example.com/original-banner.png'),
                null,
                new URL('https://example.com/ap_id'),
                new URL('https://example.com/url'),
                new URL('https://example.com/followers'),
            );

            account.updateProfile({ name: 'Updated Name' });

            expect(account.name).toBe('Updated Name');
            expect(account.bio).toBe('Original Bio');
            expect(account.username).toBe('testuser');
            expect(account.avatarUrl?.href).toBe(
                'https://example.com/original-avatar.png',
            );
            expect(account.bannerImageUrl?.href).toBe(
                'https://example.com/original-banner.png',
            );
        });

        it('can update bio', () => {
            const account = new Account(
                1,
                'test-uuid',
                'testuser',
                'Original Name',
                'Original Bio',
                new URL('https://example.com/original-avatar.png'),
                new URL('https://example.com/original-banner.png'),
                null,
                new URL('https://example.com/ap_id'),
                new URL('https://example.com/url'),
                new URL('https://example.com/followers'),
            );

            account.updateProfile({ bio: 'Updated Bio' });

            expect(account.name).toBe('Original Name');
            expect(account.bio).toBe('Updated Bio');
            expect(account.username).toBe('testuser');
            expect(account.avatarUrl?.href).toBe(
                'https://example.com/original-avatar.png',
            );
            expect(account.bannerImageUrl?.href).toBe(
                'https://example.com/original-banner.png',
            );
        });

        it('can update username', () => {
            const account = new Account(
                1,
                'test-uuid',
                'testuser',
                'Original Name',
                'Original Bio',
                new URL('https://example.com/original-avatar.png'),
                new URL('https://example.com/original-banner.png'),
                null,
                new URL('https://example.com/ap_id'),
                new URL('https://example.com/url'),
                new URL('https://example.com/followers'),
            );

            account.updateProfile({ username: 'updatedtestuser' });

            expect(account.name).toBe('Original Name');
            expect(account.bio).toBe('Original Bio');
            expect(account.username).toBe('updatedtestuser');
            expect(account.avatarUrl?.href).toBe(
                'https://example.com/original-avatar.png',
            );
            expect(account.bannerImageUrl?.href).toBe(
                'https://example.com/original-banner.png',
            );
        });

        it('can update avatarUrl', () => {
            const account = new Account(
                1,
                'test-uuid',
                'testuser',
                'Original Name',
                'Original Bio',
                new URL('https://example.com/original-avatar.png'),
                new URL('https://example.com/original-banner.png'),
                null,
                new URL('https://example.com/ap_id'),
                new URL('https://example.com/url'),
                new URL('https://example.com/followers'),
            );

            account.updateProfile({
                avatarUrl: new URL('https://example.com/updated-avatar.png'),
            });

            expect(account.name).toBe('Original Name');
            expect(account.bio).toBe('Original Bio');
            expect(account.username).toBe('testuser');
            expect(account.avatarUrl?.href).toBe(
                'https://example.com/updated-avatar.png',
            );
            expect(account.bannerImageUrl?.href).toBe(
                'https://example.com/original-banner.png',
            );
        });

        it('can update bannerImageUrl', () => {
            const account = new Account(
                1,
                'test-uuid',
                'testuser',
                'Original Name',
                'Original Bio',
                new URL('https://example.com/original-avatar.png'),
                new URL('https://example.com/original-banner.png'),
                null,
                new URL('https://example.com/ap_id'),
                new URL('https://example.com/url'),
                new URL('https://example.com/followers'),
            );

            account.updateProfile({
                bannerImageUrl: new URL(
                    'https://example.com/updated-banner.png',
                ),
            });

            expect(account.name).toBe('Original Name');
            expect(account.bio).toBe('Original Bio');
            expect(account.username).toBe('testuser');
            expect(account.avatarUrl?.href).toBe(
                'https://example.com/original-avatar.png',
            );
            expect(account.bannerImageUrl?.href).toBe(
                'https://example.com/updated-banner.png',
            );
        });

        it('can update multiple properties at once', () => {
            const account = new Account(
                1,
                'test-uuid',
                'testuser',
                'Original Name',
                'Original Bio',
                new URL('https://example.com/original-avatar.png'),
                new URL('https://example.com/original-banner.png'),
                null,
                new URL('https://example.com/ap_id'),
                new URL('https://example.com/url'),
                new URL('https://example.com/followers'),
            );

            account.updateProfile({
                name: 'Updated Name',
                bio: 'Updated Bio',
                username: 'updatedtestuser',
                avatarUrl: new URL('https://example.com/updated-avatar.png'),
                bannerImageUrl: new URL(
                    'https://example.com/updated-banner.png',
                ),
            });

            expect(account.name).toBe('Updated Name');
            expect(account.bio).toBe('Updated Bio');
            expect(account.username).toBe('updatedtestuser');
            expect(account.avatarUrl?.href).toBe(
                'https://example.com/updated-avatar.png',
            );
            expect(account.bannerImageUrl?.href).toBe(
                'https://example.com/updated-banner.png',
            );
        });

        it('can set values to null', () => {
            const account = new Account(
                1,
                'test-uuid',
                'testuser',
                'Original Name',
                'Original Bio',
                new URL('https://example.com/original-avatar.png'),
                new URL('https://example.com/original-banner.png'),
                null,
                new URL('https://example.com/ap_id'),
                new URL('https://example.com/url'),
                new URL('https://example.com/followers'),
            );

            account.updateProfile({
                bio: null,
                avatarUrl: null,
            });

            expect(account.name).toBe('Original Name');
            expect(account.bio).toBeNull();
            expect(account.username).toBe('testuser');
            expect(account.avatarUrl).toBeNull();
            expect(account.bannerImageUrl?.href).toBe(
                'https://example.com/original-banner.png',
            );
        });
    });
});
