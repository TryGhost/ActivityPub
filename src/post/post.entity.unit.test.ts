import { describe, expect, it } from 'vitest';

import { Account } from '../account/account.entity';
import { Post, PostType } from './post.entity';

function mockAccount(id: number | null, internal: boolean) {
    return new Account(
        id,
        null,
        'foobar',
        'Foo Bar',
        'Just a foobar',
        new URL('https://foobar.com/avatar/foobar.png'),
        new URL('https://foobar.com/banner/foobar.png'),
        internal
            ? {
                  id: 123,
                  host: 'foobar.com',
                  webhook_secret: 'secret',
              }
            : null,
        new URL(`https://foobar.com/user/${id}`),
        null,
    );
}

const externalAccount = (id: number | null = 456) => mockAccount(id, false);
const internalAccount = (id: number | null = 123) => mockAccount(id, true);

describe('Post', () => {
    it('should handle adding and removing reposts', () => {
        const postAuthorAccount = internalAccount(456);
        const postReposterAccount = externalAccount(789);
        const postDereposterAccount = externalAccount(987);
        const accidentalPostDereposterAccount = externalAccount(654);

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
        const postAuthorAccount = internalAccount(456);
        const postReposterAccount = externalAccount(null);
        const post = Post.createFromData(postAuthorAccount, {
            type: PostType.Note,
            content: 'Hello, world!',
        });

        expect(() => post.addRepost(postReposterAccount)).toThrow(
            'Cannot add repost for account with no id',
        );
    });

    it('should handle adding and removing likes', () => {
        const postAuthorAccount = internalAccount(456);
        const liker = externalAccount(789);
        const unliker = externalAccount(987);
        const accidentalUnliker = externalAccount(654);

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
