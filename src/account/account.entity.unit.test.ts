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
            0,
            0,
            0,
            0,
            0,
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
            0,
            0,
            0,
            0,
            0,
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
            0,
            0,
            0,
            0,
            0,
        );

        expect(account.apFollowers.href).toBe(
            'http://foobar.com/.ghost/activitypub/followers/foobar',
        );
    });

    it('Can get the total post count', () => {
        const account = new Account(
            123,
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
            new URL('https://foobar.com/user/123'),
            null,
            null,
            1,
            2,
            0,
            0,
            0,
        );

        expect(account.totalPostCount).toBe(3);
    });
});
