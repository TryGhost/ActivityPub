import { describe, expect, it } from 'vitest';

import { Account } from '../account/account.entity';
import { Post, PostType } from './post.entity';

describe('Post', () => {
    it('should handle adding and removing reposts', () => {
        const postAuthorSite = {
            id: 123,
            host: 'foobar.com',
            webhook_secret: 'secret',
        };
        const postAuthorAccount = new Account(
            456,
            null,
            'foobar',
            'Foo Bar',
            'Just a foobar',
            new URL('https://foobar.com/avatar/foobar.png'),
            new URL('https://foobar.com/banner/foobar.png'),
            postAuthorSite,
        );

        const postReposterAccount = new Account(
            789,
            null,
            'bazqux',
            'Baz Qux',
            'Just a bazqux',
            new URL('https://bazqux.com/avatar/bazqux.png'),
            new URL('https://bazqux.com/banner/bazqux.png'),
            null,
        );

        const postDereposterAccount = new Account(
            987,
            null,
            'bazqux',
            'Baz Qux',
            'Just a bazqux',
            new URL('https://bazqux.com/avatar/bazqux.png'),
            new URL('https://bazqux.com/banner/bazqux.png'),
            null,
        );

        const accidentalPostDereposterAccount = new Account(
            654,
            null,
            'bazqux',
            'Baz Qux',
            'Just a bazqux',
            new URL('https://bazqux.com/avatar/bazqux.png'),
            new URL('https://bazqux.com/banner/bazqux.png'),
            null,
        );

        const post = Post.createFromData(postAuthorAccount, {
            type: PostType.Note,
            content: 'Hello, world!',
        });

        post.addRepost(postReposterAccount);

        post.removeRepost(postDereposterAccount);

        post.addRepost(accidentalPostDereposterAccount);
        post.removeRepost(accidentalPostDereposterAccount);
        post.addRepost(accidentalPostDereposterAccount);

        expect(post.getChangedReposts()).toEqual({
            repostsToAdd: [
                postReposterAccount.id,
                accidentalPostDereposterAccount.id,
            ],
            repostsToRemove: [postDereposterAccount.id],
        });
    });

    it('should not add a repost for an account with no id', () => {
        const postAuthorSite = {
            id: 123,
            host: 'foobar.com',
            webhook_secret: 'secret',
        };
        const postAuthorAccount = new Account(
            456,
            null,
            'foobar',
            'Foo Bar',
            'Just a foobar',
            new URL('https://foobar.com/avatar/foobar.png'),
            new URL('https://foobar.com/banner/foobar.png'),
            postAuthorSite,
        );
        const postReposterAccount = new Account(
            null,
            null,
            'bazqux',
            'Baz Qux',
            'Just a bazqux',
            new URL('https://bazqux.com/avatar/bazqux.png'),
            new URL('https://bazqux.com/banner/bazqux.png'),
            null,
        );
        const post = Post.createFromData(postAuthorAccount, {
            type: PostType.Note,
            content: 'Hello, world!',
        });

        expect(() => post.addRepost(postReposterAccount)).toThrow(
            'Cannot add repost for account with no id',
        );
    });

    it('should handle adding and removing likes', () => {
        const postAuthorSite = {
            id: 123,
            host: 'foobar.com',
            webhook_secret: 'secret',
        };
        const postAuthorAccount = new Account(
            456,
            null,
            'foobar',
            'Foo Bar',
            'Just a foobar',
            new URL('https://foobar.com/avatar/foobar.png'),
            new URL('https://foobar.com/banner/foobar.png'),
            postAuthorSite,
        );

        const liker = new Account(
            789,
            null,
            'bazqux',
            'Baz Qux',
            'Just a bazqux',
            new URL('https://bazqux.com/avatar/bazqux.png'),
            new URL('https://bazqux.com/banner/bazqux.png'),
            null,
        );

        const unliker = new Account(
            987,
            null,
            'bazqux',
            'Baz Qux',
            'Just a bazqux',
            new URL('https://bazqux.com/avatar/bazqux.png'),
            new URL('https://bazqux.com/banner/bazqux.png'),
            null,
        );

        const accidentalUnliker = new Account(
            654,
            null,
            'bazqux',
            'Baz Qux',
            'Just a bazqux',
            new URL('https://bazqux.com/avatar/bazqux.png'),
            new URL('https://bazqux.com/banner/bazqux.png'),
            null,
        );

        const post = Post.createFromData(postAuthorAccount, {
            type: PostType.Note,
            content: 'Hello, world!',
        });

        post.addLike(liker);

        post.removeLike(unliker);

        post.addLike(accidentalUnliker);
        post.removeLike(accidentalUnliker);
        post.addLike(accidentalUnliker);

        expect(post.getChangedLikes()).toEqual({
            likesToAdd: [liker.id, accidentalUnliker.id],
            likesToRemove: [unliker.id],
        });
    });
});
