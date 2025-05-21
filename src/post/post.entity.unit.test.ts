import { describe, expect, it } from 'vitest';

import { type Ok, getValue, isError } from 'core/result';
import { type Account, AccountEntity } from '../account/account.entity';
import { Audience, Post, type PostData, PostType } from './post.entity';

function mockAccount(id: number | null, internal: boolean) {
    const draft = internal
        ? AccountEntity.draft({
              isInternal: true,
              host: new URL('http://foobar.com'),
              username: 'foobar',
              name: 'Foo Bar',
              bio: 'Just a foobar',
              url: null,
              avatarUrl: new URL('http://foobar.com/avatar/foobar.png'),
              bannerImageUrl: new URL('http://foobar.com/banner/foobar.png'),
          })
        : AccountEntity.draft({
              isInternal: false,
              username: 'foobar',
              name: 'Foo Bar',
              bio: 'Just a foobar',
              url: null,
              avatarUrl: new URL('http://foobar.com/avatar/foobar.png'),
              bannerImageUrl: new URL('http://foobar.com/banner/foobar.png'),
              apFollowers: new URL(`https://foobar.com/followers/${id}`),
              apInbox: new URL(`https://foobar.com/inbox/${id}`),
              apId: new URL(`https://foobar.com/user/${id}`),
          });

    return AccountEntity.create({
        id: id || 1,
        ...draft,
    });
}

const externalAccount = (id: number | null = 456) => mockAccount(id, false);
const internalAccount = (id: number | null = 123) => mockAccount(id, true);

describe('Post', () => {
    describe('delete', () => {
        it('Should be possible to delete posts authored by the account', async () => {
            const author = internalAccount();
            const ghostPost = {
                uuid: '550e8400-e29b-41d4-a716-446655440000',
                title: 'Title of my post',
                html: '<p> This is such a great post </p>',
                excerpt: 'This is such a great...',
                custom_excerpt: null,
                feature_image: 'https://ghost.org/feature-image.jpeg',
                published_at: '2020-01-01',
                url: 'https://ghost.org/post',
                visibility: 'public',
                authors: [],
            };

            const postResult = await Post.createArticleFromGhostPost(
                author,
                ghostPost,
            );
            const post = getValue(postResult as Ok<Post>) as Post;

            post.delete(author);

            expect(Post.isDeleted(post)).toBe(true);
        });

        it('Should not be possible to delete posts from other authors', async () => {
            const author = internalAccount();
            const notAuthor = externalAccount();
            const ghostPost = {
                uuid: '550e8400-e29b-41d4-a716-446655440000',
                title: 'Title of my post',
                html: '<p> This is such a great post </p>',
                excerpt: 'This is such a great...',
                custom_excerpt: null,
                feature_image: 'https://ghost.org/feature-image.jpeg',
                published_at: '2020-01-01',
                url: 'https://ghost.org/post',
                visibility: 'public',
                authors: [],
            };

            const postResult = await Post.createArticleFromGhostPost(
                author,
                ghostPost,
            );
            const post = getValue(postResult as Ok<Post>) as Post;

            expect(() => {
                post.delete(notAuthor);
            }).toThrow();

            expect(Post.isDeleted(post)).toBe(false);
        });

        it('Should set all content to null for deleted posts', async () => {
            const author = internalAccount();
            const ghostPost = {
                uuid: '550e8400-e29b-41d4-a716-446655440000',
                title: 'Title of my post',
                html: '<p> This is such a great post </p>',
                excerpt: 'This is such a great...',
                custom_excerpt: null,
                feature_image: 'https://ghost.org/feature-image.jpeg',
                published_at: '2020-01-01',
                url: 'https://ghost.org/post',
                visibility: 'public',
                authors: [
                    {
                        name: 'Author 1',
                        profile_image: 'https://image.com/author1.jpg',
                    },
                ],
            };

            const postResult = await Post.createArticleFromGhostPost(
                author,
                ghostPost,
            );
            const post = getValue(postResult as Ok<Post>) as Post;

            post.delete(author);

            expect(Post.isDeleted(post)).toBe(true);
            expect(post.type).toBe(PostType.Tombstone);
            expect(post.title).toBeNull();
            expect(post.content).toBeNull();
            expect(post.excerpt).toBeNull();
            expect(post.imageUrl).toBeNull();
            expect(post.attachments).toEqual([]);
            expect(post.metadata).toBeNull();
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
                {
                    ghostAuthors: [
                        {
                            name: 'Author 1',
                            profile_image: 'https://image.com/author1.jpg',
                        },
                    ],
                },
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
            expect(post.metadata).toBeNull();
        });
    });

    describe('createReply', () => {
        it('errors if the account is external', () => {
            const account = externalAccount();
            const inReplyTo = Post.createNote(internalAccount(), 'Parent');
            const content = 'My first note';

            expect(() =>
                Post.createReply(account, content, inReplyTo),
            ).toThrowErrorMatchingInlineSnapshot(
                '[Error: createReply is for use with internal accounts]',
            );
        });

        it('errors if the post does not have an id', () => {
            const account = internalAccount();
            const inReplyTo = Post.createNote(account, 'Parent');
            const content = 'My first note';

            expect(() =>
                Post.createReply(account, content, inReplyTo),
            ).toThrowErrorMatchingInlineSnapshot(
                '[Error: Cannot reply to a Post without an id]',
            );
        });

        it('creates a note with html content', () => {
            const account = internalAccount();
            const inReplyTo = Post.createNote(account, 'Parent');
            // TODO: Clean up the any type
            // biome-ignore lint/suspicious/noExplicitAny: Legacy code needs proper typing
            (inReplyTo as any).id = 'fake-id';
            const content = 'My first note';

            const note = Post.createReply(account, content, inReplyTo);

            expect(note.type).toBe(PostType.Note);

            expect(note.content).toBe('<p>My first note</p>');
        });

        it('creates a reply with mentions', () => {
            const account = internalAccount();
            const inReplyTo = Post.createNote(account, 'Parent');
            (inReplyTo as unknown as { id: string }).id = 'fake-id';
            const content = 'My reply to @test@example.com';
            const mentionedAccount = externalAccount(789);
            const mentions = [
                {
                    name: '@test@example.com',
                    href: new URL('https://example.com/@test'),
                    account: mentionedAccount,
                },
            ];

            const note = Post.createReply(
                account,
                content,
                inReplyTo,
                undefined,
                mentions,
            );

            expect(note.type).toBe(PostType.Note);
            expect(note.content).toBe(
                '<p>My reply to <a href="https://example.com/@test" data-profile="@test@example.com" rel="nofollow noopener noreferrer">@test@example.com</a></p>',
            );
            expect(note.mentions).toEqual([mentionedAccount]);
        });

        it('creates a reply with multiple mentions', () => {
            const account = internalAccount();
            const inReplyTo = Post.createNote(account, 'Parent');
            (inReplyTo as unknown as { id: string }).id = 'fake-id';
            const content =
                'My reply to @test@example.com and @test2@example.com';
            const mentionedAccount1 = externalAccount(789);
            const mentionedAccount2 = externalAccount(790);
            const mentions = [
                {
                    name: '@test@example.com',
                    href: new URL('https://example.com/@test'),
                    account: mentionedAccount1,
                },
                {
                    name: '@test2@example.com',
                    href: new URL('https://example.com/@test2'),
                    account: mentionedAccount2,
                },
            ];

            const note = Post.createReply(
                account,
                content,
                inReplyTo,
                undefined,
                mentions,
            );

            expect(note.type).toBe(PostType.Note);
            expect(note.content).toBe(
                '<p>My reply to <a href="https://example.com/@test" data-profile="@test@example.com" rel="nofollow noopener noreferrer">@test@example.com</a> and <a href="https://example.com/@test2" data-profile="@test2@example.com" rel="nofollow noopener noreferrer">@test2@example.com</a></p>',
            );
            expect(note.mentions).toEqual([
                mentionedAccount1,
                mentionedAccount2,
            ]);
        });

        it('creates a note with line breaks', () => {
            const account = internalAccount();
            const inReplyTo = Post.createNote(account, 'Parent');
            // TODO: Clean up the any type
            // biome-ignore lint/suspicious/noExplicitAny: Legacy code needs proper typing
            (inReplyTo as any).id = 'fake-id';
            const content = `My
                            first
                            note`;

            const note = Post.createReply(account, content, inReplyTo);

            expect(note.type).toBe(PostType.Note);

            expect(note.content).toBe('<p>My<br />first<br />note</p>');
        });

        it('creates a note with escaped html', () => {
            const account = internalAccount();
            const inReplyTo = Post.createNote(account, 'Parent');
            // TODO: Clean up the any type
            // biome-ignore lint/suspicious/noExplicitAny: Legacy code needs proper typing
            (inReplyTo as any).id = 'fake-id';
            const content = '<script>alert("hax")</script> Hello, world!';

            const note = Post.createReply(account, content, inReplyTo);

            expect(note.type).toBe(PostType.Note);

            expect(note.content).toBe(
                '<p>&lt;script&gt;alert("hax")&lt;/script&gt; Hello, world!</p>',
            );
        });

        it('creates a note with links', () => {
            const account = internalAccount();
            const inReplyTo = Post.createNote(account, 'Parent');
            // TODO: Clean up the any type
            // biome-ignore lint/suspicious/noExplicitAny: Legacy code needs proper typing
            (inReplyTo as any).id = 'fake-id';
            const content = 'Check out https://ghost.org it is super cool';

            const note = Post.createReply(account, content, inReplyTo);

            expect(note.type).toBe(PostType.Note);

            expect(note.content).toBe(
                '<p>Check out <a href="https://ghost.org">https://ghost.org</a> it is super cool</p>',
            );
        });

        it('does not convert handles to mailto', () => {
            const account = internalAccount();
            const inReplyTo = Post.createNote(account, 'Parent');
            // TODO: Clean up the any type
            // biome-ignore lint/suspicious/noExplicitAny: Legacy code needs proper typing
            (inReplyTo as any).id = 'fake-id';
            const content =
                'I wish I could mention someone like @index@activitypub.ghost.org';

            const note = Post.createReply(account, content, inReplyTo);

            expect(note.type).toBe(PostType.Note);

            expect(note.content).toBe(
                '<p>I wish I could mention someone like @index@activitypub.ghost.org</p>',
            );
        });

        it('does not convert emails to mailto', () => {
            const account = internalAccount();
            const inReplyTo = Post.createNote(account, 'Parent');
            // TODO: Clean up the any type
            // biome-ignore lint/suspicious/noExplicitAny: Legacy code needs proper typing
            (inReplyTo as any).id = 'fake-id';
            const content = 'Email me at support@ghost.org';

            const note = Post.createReply(account, content, inReplyTo);

            expect(note.type).toBe(PostType.Note);

            expect(note.content).toBe('<p>Email me at support@ghost.org</p>');
        });
    });
    describe('createNote', () => {
        it('errors if the account is external', () => {
            const account = externalAccount();
            const content = 'My first note';

            expect(() =>
                Post.createNote(account, content),
            ).toThrowErrorMatchingInlineSnapshot(
                '[Error: createNote is for use with internal accounts]',
            );
        });

        it('creates a note with html content', () => {
            const account = internalAccount();
            const content = 'My first note';

            const note = Post.createNote(account, content);

            expect(note.type).toBe(PostType.Note);

            expect(note.content).toBe('<p>My first note</p>');
        });

        it('creates a note with mentions', () => {
            const account = internalAccount();
            const content = 'My note with @test@example.com';
            const mentionedAccount = externalAccount(789);
            const mentions = [
                {
                    name: '@test@example.com',
                    href: new URL('https://example.com/@test'),
                    account: mentionedAccount,
                },
            ];

            const note = Post.createNote(account, content, undefined, mentions);

            expect(note.type).toBe(PostType.Note);
            expect(note.content).toBe(
                '<p>My note with <a href="https://example.com/@test" data-profile="@test@example.com" rel="nofollow noopener noreferrer">@test@example.com</a></p>',
            );
            expect(note.mentions).toEqual([mentionedAccount]);
        });

        it('creates a note with multiple mentions', () => {
            const account = internalAccount();
            const content =
                'My note with @test@example.com and @test2@example.com';
            const mentionedAccount1 = externalAccount(789);
            const mentionedAccount2 = externalAccount(790);
            const mentions = [
                {
                    name: '@test@example.com',
                    href: new URL('https://example.com/@test'),
                    account: mentionedAccount1,
                },
                {
                    name: '@test2@example.com',
                    href: new URL('https://example.com/@test2'),
                    account: mentionedAccount2,
                },
            ];

            const note = Post.createNote(account, content, undefined, mentions);

            expect(note.type).toBe(PostType.Note);
            expect(note.content).toBe(
                '<p>My note with <a href="https://example.com/@test" data-profile="@test@example.com" rel="nofollow noopener noreferrer">@test@example.com</a> and <a href="https://example.com/@test2" data-profile="@test2@example.com" rel="nofollow noopener noreferrer">@test2@example.com</a></p>',
            );
            expect(note.mentions).toEqual([
                mentionedAccount1,
                mentionedAccount2,
            ]);
        });

        it('creates a note with an image URL', () => {
            const account = internalAccount();
            const content = 'My first note';
            const imageUrl = 'https://example.com/image.jpg';

            const note = Post.createNote(account, content, new URL(imageUrl));

            expect(note.type).toBe(PostType.Note);
            expect(note.content).toBe('<p>My first note</p>');
            expect(note.attachments).toEqual([
                {
                    type: 'Image',
                    mediaType: null,
                    name: null,
                    url: new URL(imageUrl),
                },
            ]);
        });

        it('creates a note with line breaks', () => {
            const account = internalAccount();
            const content = `My
                            first
                            note`;

            const note = Post.createNote(account, content);

            expect(note.type).toBe(PostType.Note);

            expect(note.content).toBe('<p>My<br />first<br />note</p>');
        });

        it('creates a note with escaped html', () => {
            const account = internalAccount();
            const content = '<script>alert("hax")</script> Hello, world!';

            const note = Post.createNote(account, content);

            expect(note.type).toBe(PostType.Note);

            expect(note.content).toBe(
                '<p>&lt;script&gt;alert("hax")&lt;/script&gt; Hello, world!</p>',
            );
        });

        it('creates a note with links', () => {
            const account = internalAccount();
            const content = 'Check out https://ghost.org it is super cool';

            const note = Post.createNote(account, content);

            expect(note.type).toBe(PostType.Note);

            expect(note.content).toBe(
                '<p>Check out <a href="https://ghost.org">https://ghost.org</a> it is super cool</p>',
            );
        });
    });

    it('should correctly create an article from a Ghost Post', async () => {
        const account = internalAccount();
        const ghostPost = {
            uuid: '550e8400-e29b-41d4-a716-446655440000',
            title: 'Title of my post',
            html: '<p> This is such a great post </p>',
            excerpt: 'This is such a great...',
            custom_excerpt: null,
            feature_image: 'https://ghost.org/feature-image.jpeg',
            published_at: '2020-01-01',
            url: 'https://ghost.org/post',
            visibility: 'public',
            authors: [],
        };

        const postResult = await Post.createArticleFromGhostPost(
            account,
            ghostPost,
        );
        const post = getValue(postResult as Ok<Post>) as Post;

        expect(post.uuid).toEqual(ghostPost.uuid);
        expect(post.content).toEqual(ghostPost.html);
    });

    it('should refuse to create an article from a private Ghost Post with no public content', async () => {
        const account = internalAccount();
        const ghostPost = {
            uuid: '550e8400-e29b-41d4-a716-446655440000',
            title: 'Title of my post',
            html: '<!--members-only--><p> This is such a great post </p>',
            excerpt: 'This is such a great...',
            custom_excerpt: null,
            feature_image: 'https://ghost.org/feature-image.jpeg',
            published_at: '2020-01-01',
            url: 'https://ghost.org/post',
            visibility: 'members',
            authors: [],
        };

        const postResult = await Post.createArticleFromGhostPost(
            account,
            ghostPost,
        );
        expect(isError(postResult)).toBe(true);
    });

    it('should create an article with restricted content from a private Ghost Post', async () => {
        const account = internalAccount();
        const ghostPost = {
            uuid: '550e8400-e29b-41d4-a716-446655440000',
            title: 'Title of my post',
            html: '<p>Welcome!</p><img src="https://ghost.org/feature-image.jpeg" /><!--members-only--><p>This is private content</p>',
            excerpt: 'Welcome!\n\nThis is private content',
            custom_excerpt: null,
            feature_image: 'https://ghost.org/feature-image.jpeg',
            published_at: '2020-01-01',
            url: 'https://ghost.org/post',
            visibility: 'members',
            authors: [],
        };

        const postResult = await Post.createArticleFromGhostPost(
            account,
            ghostPost,
        );
        const post = getValue(postResult as Ok<Post>) as Post;

        expect(post.uuid).toEqual(ghostPost.uuid);
        expect(post.content).toEqual(
            '<p>Welcome!</p><img src="https://ghost.org/feature-image.jpeg" /><div class="gh-paid-content-notice"><h3>Upgrade to continue reading</h3><p>Become a paid member to get access to all premium content</p><a class="gh-paid-content-cta" href="https://ghost.org/post#/portal/signup">Upgrade</a></div>',
        );
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

    it('should handle adding mentions', () => {
        const postAuthorAccount = internalAccount(456);
        const mentionedAccount1 = externalAccount(789);
        const mentionedAccount2 = externalAccount(987);
        const mentionedAccount3 = externalAccount(654);

        const post = Post.createFromData(postAuthorAccount, {
            type: PostType.Note,
            content: 'Hello, world!',
        });

        post.addMention(mentionedAccount1);
        post.addMention(mentionedAccount2);
        post.addMention(mentionedAccount3);

        expect(post.mentions).toEqual([
            mentionedAccount1,
            mentionedAccount2,
            mentionedAccount3,
        ]);
    });

    it('should save ghost authors in posts metadata', async () => {
        const account = internalAccount();
        const ghostPost = {
            uuid: '550e8400-e29b-41d4-a716-446655440000',
            title: 'Title of my post',
            html: '<p>Welcome!</p><img src="https://ghost.org/feature-image.jpeg" /><!--members-only--><p>This is private content</p>',
            excerpt: 'Welcome!\n\nThis is private content',
            custom_excerpt: null,
            feature_image: 'https://ghost.org/feature-image.jpeg',
            published_at: '2020-01-01',
            url: 'https://ghost.org/post',
            visibility: 'members',
            authors: [
                {
                    name: 'Author 1',
                    profile_image: 'https://image.com/author1.jpg',
                },
                {
                    name: 'Author 2',
                    profile_image: null,
                },
            ],
        };

        const postResult = await Post.createArticleFromGhostPost(
            account,
            ghostPost,
        );
        const post = getValue(postResult as Ok<Post>) as Post;

        expect(post.metadata).toEqual({
            ghostAuthors: [
                {
                    name: 'Author 1',
                    profile_image: 'https://image.com/author1.jpg',
                },
                {
                    name: 'Author 2',
                    profile_image: null,
                },
            ],
        });
    });

    it('should handle an empty array of ghost authors', async () => {
        const account = internalAccount();
        const ghostPost = {
            uuid: '550e8400-e29b-41d4-a716-446655440000',
            title: 'Title of my post',
            html: '<p>Welcome!</p><img src="https://ghost.org/feature-image.jpeg" /><!--members-only--><p>This is private content</p>',
            excerpt: 'Welcome!\n\nThis is private content',
            custom_excerpt: null,
            feature_image: 'https://ghost.org/feature-image.jpeg',
            published_at: '2020-01-01',
            url: 'https://ghost.org/post',
            visibility: 'members',
            authors: [],
        };

        const postResult = await Post.createArticleFromGhostPost(
            account,
            ghostPost,
        );
        const post = getValue(postResult as Ok<Post>) as Post;

        expect(post.metadata).toEqual({
            ghostAuthors: [],
        });
    });

    describe('post excerpt', () => {
        describe('when the post is public', () => {
            it('should not re-generate excerpt', async () => {
                const account = internalAccount();
                const ghostPost = {
                    uuid: '550e8400-e29b-41d4-a716-446655440000',
                    title: 'Title of my post',
                    html: '<p>Hello world!</p>',
                    excerpt: 'Hello world!',
                    custom_excerpt: null,
                    feature_image: 'https://ghost.org/feature-image.jpeg',
                    published_at: '2020-01-01',
                    url: 'https://ghost.org/post',
                    visibility: 'public',
                    authors: [],
                };

                const postResult = await Post.createArticleFromGhostPost(
                    account,
                    ghostPost,
                );
                const post = getValue(postResult as Ok<Post>) as Post;

                expect(post.excerpt).toEqual(ghostPost.excerpt);
            });

            it('should not re-generate excerpt even if there is a paywall', async () => {
                const account = internalAccount();
                const ghostPost = {
                    uuid: '550e8400-e29b-41d4-a716-446655440000',
                    title: 'Title of my post',
                    html: '<p>Hello world!</p><!--members-only--><p>This is after the paywall</p>',
                    excerpt: 'Hello world!\n\nThis is after the paywall',
                    custom_excerpt: null,
                    feature_image: 'https://ghost.org/feature-image.jpeg',
                    published_at: '2020-01-01',
                    url: 'https://ghost.org/post',
                    visibility: 'public', // The visibility is public -> ignore paywall
                    authors: [],
                };

                const postResult = await Post.createArticleFromGhostPost(
                    account,
                    ghostPost,
                );
                const post = getValue(postResult as Ok<Post>) as Post;

                expect(post.excerpt).toEqual(ghostPost.excerpt);
            });
        });

        describe('when the post is members-only', () => {
            describe('and there is no custom excerpt', () => {
                it('should re-generate excerpt without the gated content and without the paid signup message', async () => {
                    const account = internalAccount();
                    const ghostPost = {
                        uuid: '550e8400-e29b-41d4-a716-446655440000',
                        title: 'Title of my post',
                        html: '<p>Hello world!</p><!--members-only--><p>This is private content</p>',
                        excerpt: 'Hello world!\n\nThis is private content',
                        custom_excerpt: null,
                        feature_image: 'https://ghost.org/feature-image.jpeg',
                        published_at: '2020-01-01',
                        url: 'https://ghost.org/post',
                        visibility: 'members',
                        authors: [],
                    };

                    const postResult = await Post.createArticleFromGhostPost(
                        account,
                        ghostPost,
                    );
                    const post = getValue(postResult as Ok<Post>) as Post;

                    expect(post.excerpt).toEqual('Hello world!');
                });
            });

            describe('and there is a custom excerpt', () => {
                it('should not re-generate the excerpt', async () => {
                    const account = internalAccount();
                    const ghostPost = {
                        uuid: '550e8400-e29b-41d4-a716-446655440000',
                        title: 'Title of my post',
                        html: '<p>Hello world!</p><!--members-only--><p>This is private content</p>',
                        excerpt: 'Custom excerpt',
                        custom_excerpt: 'Custom excerpt',
                        feature_image: 'https://ghost.org/feature-image.jpeg',
                        published_at: '2020-01-01',
                        url: 'https://ghost.org/post',
                        visibility: 'members',
                        authors: [],
                    };

                    const postResult = await Post.createArticleFromGhostPost(
                        account,
                        ghostPost,
                    );
                    const post = getValue(postResult as Ok<Post>) as Post;

                    expect(post.excerpt).toEqual(ghostPost.excerpt);
                });
            });
        });
    });

    describe('createFromData', () => {
        it('creates a post of type note', async () => {
            const account = internalAccount();
            const postData = {
                type: PostType.Note,
                content: 'This is a test note',
            } as PostData;

            const result = Post.createFromData(account, postData);

            expect(result).toBeInstanceOf(Post);
            expect(result.content).toBe('This is a test note');
        });

        it('attaches mentions to the post but should not modify content with no hyperlink', async () => {
            const account = internalAccount();
            const extAccount = externalAccount() as Account;
            const mention = {
                name: '@foobar@foobar.com',
                href: extAccount.url,
                account: extAccount,
            };

            const postData = {
                type: PostType.Note,
                content:
                    '<p>This is a test note with a mention @foobar@foobar.com</p>',
                mentions: [mention],
            } as PostData;

            const result = Post.createFromData(account, postData);

            expect(result).toBeInstanceOf(Post);
            expect(result.mentions).toEqual([extAccount]);
            expect(result.content).toBe(
                '<p>This is a test note with a mention @foobar@foobar.com</p>',
            );
        });

        it('attaches mentions to the post and modify existing hyperlinks', async () => {
            const account = internalAccount();
            const extAccount = externalAccount() as Account;
            const mention = {
                name: '@foobar@foobar.com',
                href: extAccount.url,
                account: extAccount,
            };

            const postData = {
                type: PostType.Note,
                content: `<p>This is a test note with a mention <a href="${extAccount.url}">@foobar@foobar.com</a></p>`,
                mentions: [mention],
            } as PostData;

            const result = Post.createFromData(account, postData);
            expect(result).toBeInstanceOf(Post);
            expect(result.mentions).toEqual([extAccount]);
            expect(result.content).toBe(
                `<p>This is a test note with a mention <a href="${extAccount.url}" data-profile="@${extAccount.username}@${extAccount.apId.hostname}" rel="nofollow noopener noreferrer">@foobar@foobar.com</a></p>`,
            );
        });
    });
});
