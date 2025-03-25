import { describe, expect, it } from 'vitest';

import { Account } from '../account/account.entity';
import { Audience, Post, PostType } from './post.entity';

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
              }
            : null,
        new URL(`https://foobar.com/user/${id}`),
        null,
        new URL(`https://foobar.com/followers/${id}`),
    );
}

const externalAccount = (id: number | null = 456) => mockAccount(id, false);
const internalAccount = (id: number | null = 123) => mockAccount(id, true);

describe('Post', () => {
    describe('delete', () => {
        it('Should be possible to delete posts authored by the account', () => {
            const author = internalAccount();
            const ghostPost = {
                uuid: '550e8400-e29b-41d4-a716-446655440000',
                title: 'Title of my post',
                html: '<p> This is such a great post </p>',
                excerpt: 'This is such a great...',
                feature_image: 'https://ghost.org/feature-image.jpeg',
                published_at: '2020-01-01',
                url: 'https://ghost.org/post',
                visibility: 'public',
            };

            const post = Post.createArticleFromGhostPost(author, ghostPost);

            post.delete(author);

            expect(Post.isDeleted(post)).toBe(true);
        });

        it('Should not be possible to delete posts from other authors', () => {
            const author = internalAccount();
            const notAuthor = externalAccount();
            const ghostPost = {
                uuid: '550e8400-e29b-41d4-a716-446655440000',
                title: 'Title of my post',
                html: '<p> This is such a great post </p>',
                excerpt: 'This is such a great...',
                feature_image: 'https://ghost.org/feature-image.jpeg',
                published_at: '2020-01-01',
                url: 'https://ghost.org/post',
                visibility: 'public',
            };

            const post = Post.createArticleFromGhostPost(author, ghostPost);

            expect(() => {
                post.delete(notAuthor);
            }).toThrow();

            expect(Post.isDeleted(post)).toBe(false);
        });

        it('Should set all content to null for deleted posts', () => {
            const author = internalAccount();
            const ghostPost = {
                uuid: '550e8400-e29b-41d4-a716-446655440000',
                title: 'Title of my post',
                html: '<p> This is such a great post </p>',
                excerpt: 'This is such a great...',
                feature_image: 'https://ghost.org/feature-image.jpeg',
                published_at: '2020-01-01',
                url: 'https://ghost.org/post',
                visibility: 'public',
            };

            const post = Post.createArticleFromGhostPost(author, ghostPost);

            post.delete(author);

            expect(Post.isDeleted(post)).toBe(true);
            expect(post.type).toBe(PostType.Tombstone);
            expect(post.title).toBeNull();
            expect(post.content).toBeNull();
            expect(post.excerpt).toBeNull();
            expect(post.imageUrl).toBeNull();
            expect(post.attachments).toEqual([]);
        });

        it('Should set all content to null for already deleted posts', () => {
            const author = internalAccount();

            const post = new Post(
                1,
                '550e8400-e29b-41d4-a716-446655440000',
                author,
                PostType.Note,
                Audience.Public,
                'Title of my post',
                'This is such a great...',
                '<p> This is such a great post </p>',
                new URL('https://ghost.org/ap/note/123'),
                new URL('https://ghost.org/feature-image.jpeg'),
                new Date('2020-01-01'),
                5,
                10,
                15,
                null,
                null,
                null,
                [
                    {
                        type: 'Image',
                        mediaType: 'image/jpeg',
                        name: 'Cat Pic',
                        url: new URL('https://ghost.org/cat.jpg'),
                    },
                ],
                new URL('https://ghost.org/ap/note/123'),
                true,
            );

            expect(Post.isDeleted(post)).toBe(true);
            expect(post.type).toBe(PostType.Tombstone);
            expect(post.title).toBeNull();
            expect(post.content).toBeNull();
            expect(post.excerpt).toBeNull();
            expect(post.imageUrl).toBeNull();
            expect(post.attachments).toEqual([]);
        });
    });

    it('should correctly create an article from a Ghost Post', () => {
        const account = internalAccount();
        const ghostPost = {
            uuid: '550e8400-e29b-41d4-a716-446655440000',
            title: 'Title of my post',
            html: '<p> This is such a great post </p>',
            excerpt: 'This is such a great...',
            feature_image: 'https://ghost.org/feature-image.jpeg',
            published_at: '2020-01-01',
            url: 'https://ghost.org/post',
            visibility: 'public',
        };

        const post = Post.createArticleFromGhostPost(account, ghostPost);

        expect(post.uuid).toEqual(ghostPost.uuid);
        expect(post.content).toEqual(ghostPost.html);
    });

    it('should refuse to create an article from a private Ghost Post with no public content', () => {
        const account = internalAccount();
        const ghostPost = {
            uuid: '550e8400-e29b-41d4-a716-446655440000',
            title: 'Title of my post',
            html: '<!--members-only--><p> This is such a great post </p>',
            excerpt: 'This is such a great...',
            feature_image: 'https://ghost.org/feature-image.jpeg',
            published_at: '2020-01-01',
            url: 'https://ghost.org/post',
            visibility: 'members',
        };

        expect(() =>
            Post.createArticleFromGhostPost(account, ghostPost),
        ).toThrow();
    });

    it('should create an article with restricted content & excerpt from a private Ghost Post', () => {
        const account = internalAccount();
        const ghostPost = {
            uuid: '550e8400-e29b-41d4-a716-446655440000',
            title: 'Title of my post',
            html: '<p>Welcome!</p><img src="https://ghost.org/feature-image.jpeg" /><!--members-only--><p>This is private content</p>',
            excerpt: 'Welcome!\n\nThis is private content',
            feature_image: 'https://ghost.org/feature-image.jpeg',
            published_at: '2020-01-01',
            url: 'https://ghost.org/post',
            visibility: 'members',
        };

        const post = Post.createArticleFromGhostPost(account, ghostPost);

        expect(post.uuid).toEqual(ghostPost.uuid);
        expect(post.content).toEqual(
            '<p>Welcome!</p><img src="https://ghost.org/feature-image.jpeg" />',
        );
        expect(post.excerpt).toEqual('Welcome!');
    });

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

    it('should sanitize HTML content when creating a new post', () => {
        const author = internalAccount();
        const maliciousContent =
            '<p>Hello world!</p><script>alert("hax")</script>';

        const post = Post.createFromData(author, {
            type: PostType.Note,
            content: maliciousContent,
        });

        expect(post.content).toEqual('<p>Hello world!</p><script></script>');
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
