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
        );

        expect(account.url).toEqual(account.apId);
    });
});
