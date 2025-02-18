import { describe, expect, it } from 'vitest';

import { Account } from '../account/account.entity';
import { Post, PostType } from './post.entity';

describe('Post', () => {
    it('should add a repost', () => {
        const postAuthorSite = {
            id: 123,
            host: 'foobar.com',
            webhook_secret: 'secret',
        };
        const postAuthorAccount = new Account(
            456,
            'foobar',
            'Foo Bar',
            'Just a foobar',
            new URL('https://foobar.com/avatar/foobar.png'),
            new URL('https://foobar.com/banner/foobar.png'),
            postAuthorSite,
        );

        const post = Post.createFromData(postAuthorAccount, {
            type: PostType.Note,
            content: 'Hello, world!',
        });

        const reposterAccount = new Account(
            789,
            'bazqux',
            'Baz Qux',
            'Just a bazqux',
            new URL('https://bazqux.com/avatar/bazqux.png'),
            new URL('https://bazqux.com/banner/bazqux.png'),
            null,
        );

        post.addRepost(reposterAccount);

        expect(post.getPotentiallyNewReposts()).toEqual([789]);
    });

    it('should not add a repost for an account with no id', () => {
        const postAuthorSite = {
            id: 123,
            host: 'foobar.com',
            webhook_secret: 'secret',
        };
        const postAuthorAccount = new Account(
            456,
            'foobar',
            'Foo Bar',
            'Just a foobar',
            new URL('https://foobar.com/avatar/foobar.png'),
            new URL('https://foobar.com/banner/foobar.png'),
            postAuthorSite,
        );

        const post = Post.createFromData(postAuthorAccount, {
            type: PostType.Note,
            content: 'Hello, world!',
        });

        const reposterAccount = new Account(
            null,
            'bazqux',
            'Baz Qux',
            'Just a bazqux',
            new URL('https://bazqux.com/avatar/bazqux.png'),
            new URL('https://bazqux.com/banner/bazqux.png'),
            null,
        );

        expect(() => post.addRepost(reposterAccount)).toThrow(
            'Cannot add repost for account with no id',
        );
    });
});
