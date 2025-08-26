import { describe, expect, it } from 'vitest';

import { getValue, isError, type Ok } from '@/core/result';
import {
    Audience,
    Post,
    type PostData,
    PostSummary,
    PostTitle,
    PostType,
    type PostUpdateParams,
} from '@/post/post.entity';
import {
    createTestExternalAccount,
    createTestInternalAccount,
} from '@/test/account-entity-test-helpers';

const externalAccount = async (id: number | null = 456) =>
    createTestExternalAccount(id || 456, {
        username: 'foobar',
        name: 'Foo Bar',
        bio: 'Just a foobar',
        url: null,
        avatarUrl: new URL('http://foobar.com/avatar/foobar.png'),
        bannerImageUrl: new URL('http://foobar.com/banner/foobar.png'),
        customFields: {
            foo: 'bar',
        },
        apFollowers: new URL(`https://foobar.com/followers/${id || 456}`),
        apInbox: new URL(`https://foobar.com/inbox/${id || 456}`),
        apId: new URL(`https://foobar.com/user/${id || 456}`),
    });

const internalAccount = async (id: number | null = 123) =>
    createTestInternalAccount(id || 123, {
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

describe('Post', () => {
    describe('delete', () => {
        it('Should be possible to delete posts authored by the account', async () => {
            const author = await internalAccount();
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
            const author = await internalAccount();
            const notAuthor = await externalAccount();
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
            const author = await internalAccount();
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
            expect(post.summary).toBeNull();
            expect(post.imageUrl).toBeNull();
            expect(post.attachments).toEqual([]);
            expect(post.metadata).toBeNull();
        });

        it('Should set all content to null for already deleted posts', async () => {
            const author = await internalAccount();

            const post = new Post(
                1,
                '550e8400-e29b-41d4-a716-446655440000',
                author,
                PostType.Note,
                Audience.Public,
                PostTitle.parse('Title of my post'),
                PostSummary.parse('This is such a great...'),
                null,
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
            expect(post.summary).toBeNull();
            expect(post.imageUrl).toBeNull();
            expect(post.attachments).toEqual([]);
            expect(post.metadata).toBeNull();
        });
    });

    describe('createReply', () => {
        it('errors if the account is external', async () => {
            const account = await externalAccount();
            const inReplyTo = Post.createNote(
                await internalAccount(),
                'Parent',
            );
            const content = 'My first note';

            expect(() =>
                Post.createReply(account, content, inReplyTo),
            ).toThrowErrorMatchingInlineSnapshot(
                '[Error: createReply is for use with internal accounts]',
            );
        });

        it('errors if the post does not have an id', async () => {
            const account = await internalAccount();
            const inReplyTo = Post.createNote(account, 'Parent');
            const content = 'My first note';

            expect(() =>
                Post.createReply(account, content, inReplyTo),
            ).toThrowErrorMatchingInlineSnapshot(
                '[Error: Cannot reply to a Post without an id]',
            );
        });

        it('creates a note with html content', async () => {
            const account = await internalAccount();
            const inReplyTo = Post.createNote(account, 'Parent');
            // TODO: Clean up the any type
            // biome-ignore lint/suspicious/noExplicitAny: Legacy code needs proper typing
            (inReplyTo as any).id = 'fake-id';
            const content = 'My first note';

            const note = Post.createReply(account, content, inReplyTo);

            expect(note.type).toBe(PostType.Note);

            expect(note.content).toBe('<p>My first note</p>');
        });

        it('creates a reply with mentions', async () => {
            const account = await internalAccount();
            const inReplyTo = Post.createNote(account, 'Parent');
            (inReplyTo as unknown as { id: string }).id = 'fake-id';
            const content = 'My reply to @test@example.com';
            const mentionedAccount = await externalAccount(789);
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

        it('creates a reply with multiple mentions', async () => {
            const account = await internalAccount();
            const inReplyTo = Post.createNote(account, 'Parent');
            (inReplyTo as unknown as { id: string }).id = 'fake-id';
            const content =
                'My reply to @test@example.com and @test2@example.com';
            const mentionedAccount1 = await externalAccount(789);
            const mentionedAccount2 = await externalAccount(790);
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

        it('creates a note with line breaks', async () => {
            const account = await internalAccount();
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

        it('creates a note with escaped html', async () => {
            const account = await internalAccount();
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

        it('creates a note with links', async () => {
            const account = await internalAccount();
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

        it('does not convert handles to mailto', async () => {
            const account = await internalAccount();
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

        it('does not convert emails to mailto', async () => {
            const account = await internalAccount();
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
        it('errors if the account is external', async () => {
            const account = await externalAccount();
            const content = 'My first note';

            expect(() =>
                Post.createNote(account, content),
            ).toThrowErrorMatchingInlineSnapshot(
                '[Error: createNote is for use with internal accounts]',
            );
        });

        it('creates a note with html content', async () => {
            const account = await internalAccount();
            const content = 'My first note';

            const note = Post.createNote(account, content);

            expect(note.type).toBe(PostType.Note);

            expect(note.content).toBe('<p>My first note</p>');
        });

        it('creates a note with mentions', async () => {
            const account = await internalAccount();
            const content = 'My note with @test@example.com';
            const mentionedAccount = await externalAccount(789);
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

        it('creates a note with multiple mentions', async () => {
            const account = await internalAccount();
            const content =
                'My note with @test@example.com and @test2@example.com';
            const mentionedAccount1 = await externalAccount(789);
            const mentionedAccount2 = await externalAccount(790);
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

        it('creates a note with an image URL', async () => {
            const account = await internalAccount();
            const content = 'My first note';
            const imageUrl = 'https://example.com/image.jpg';

            const note = Post.createNote(account, content, {
                url: new URL(imageUrl),
                altText: 'Image alt text',
            });

            expect(note.type).toBe(PostType.Note);
            expect(note.content).toBe('<p>My first note</p>');
            expect(note.attachments).toEqual([
                {
                    type: 'Image',
                    mediaType: null,
                    name: 'Image alt text',
                    url: new URL(imageUrl),
                },
            ]);
        });

        it('creates a note with line breaks', async () => {
            const account = await internalAccount();
            const content = `My
                            first
                            note`;

            const note = Post.createNote(account, content);

            expect(note.type).toBe(PostType.Note);

            expect(note.content).toBe('<p>My<br />first<br />note</p>');
        });

        it('creates a note with escaped html', async () => {
            const account = await internalAccount();
            const content = '<script>alert("hax")</script> Hello, world!';

            const note = Post.createNote(account, content);

            expect(note.type).toBe(PostType.Note);

            expect(note.content).toBe(
                '<p>&lt;script&gt;alert("hax")&lt;/script&gt; Hello, world!</p>',
            );
        });

        it('creates a note with links', async () => {
            const account = await internalAccount();
            const content = 'Check out https://ghost.org it is super cool';

            const note = Post.createNote(account, content);

            expect(note.type).toBe(PostType.Note);

            expect(note.content).toBe(
                '<p>Check out <a href="https://ghost.org">https://ghost.org</a> it is super cool</p>',
            );
        });
    });

    it('should correctly create an article from a Ghost Post', async () => {
        const account = await internalAccount();
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

        expect(post.uuid).not.toBe(ghostPost.uuid);
        expect(post.content).toEqual(ghostPost.html);
        expect(post.summary).toBeNull();
    });

    it('should use custom_excerpt as summary when creating an article from a Ghost Post', async () => {
        const account = await internalAccount();
        const ghostPost = {
            uuid: '550e8400-e29b-41d4-a716-446655440000',
            title: 'Title of my post',
            html: '<p> This is such a great post </p>',
            excerpt: 'This is such a great...',
            custom_excerpt: 'This is my custom excerpt for the post',
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

        expect(post.uuid).not.toBe(ghostPost.uuid);
        expect(post.content).toEqual(ghostPost.html);
        expect(post.excerpt).toEqual(ghostPost.excerpt);
        expect(post.summary).toEqual(ghostPost.custom_excerpt);
    });

    it('should refuse to create an article from a private Ghost Post with no public content', async () => {
        const account = await internalAccount();
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
        const account = await internalAccount();
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

        expect(post.uuid).not.toBe(ghostPost.uuid);
        expect(post.content).toEqual(
            '<p>Welcome!</p><img src="https://ghost.org/feature-image.jpeg" /><div class="gh-paid-content-notice"><h3>This post is for subscribers only</h3><p>Become a member to get access to all content</p><a class="gh-paid-content-cta" href="https://ghost.org/post#/portal/signup">Subscribe now</a></div>',
        );
    });

    it('should handle adding and removing reposts', async () => {
        const postAuthorAccount = await internalAccount(456);
        const postReposterAccount = await externalAccount(789);
        const postDereposterAccount = await externalAccount(987);
        const accidentalPostDereposterAccount = await externalAccount(654);

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

    it('should sanitize HTML content when creating a new post', async () => {
        const author = await internalAccount();
        const maliciousContent =
            '<p>Hello world!</p><script>alert("hax")</script>';

        const post = Post.createFromData(author, {
            type: PostType.Note,
            content: maliciousContent,
        });

        expect(post.content).toEqual('<p>Hello world!</p><script></script>');
    });

    it('should handle adding and removing likes', async () => {
        const postAuthorAccount = await internalAccount(456);
        const liker = await externalAccount(789);
        const unliker = await externalAccount(987);
        const accidentalUnliker = await externalAccount(654);

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

    it('should handle adding mentions', async () => {
        const postAuthorAccount = await internalAccount(456);
        const mentionedAccount1 = await externalAccount(789);
        const mentionedAccount2 = await externalAccount(987);
        const mentionedAccount3 = await externalAccount(654);

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
        const account = await internalAccount();
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
        const account = await internalAccount();
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

    it('should indicate if the post is created by an internal account', async () => {
        const post = Post.createFromData(await internalAccount(), {
            type: PostType.Note,
            content: 'Hello, world!',
        });

        expect(post.isInternal).toBe(true);

        const post2 = Post.createFromData(await externalAccount(), {
            type: PostType.Note,
            content: 'Hello, world!',
            apId: new URL('https://example.com/post'),
        });
        expect(post2.isInternal).toBe(false);
    });

    describe('post excerpt', () => {
        describe('when the post is public', () => {
            it('should not re-generate excerpt', async () => {
                const account = await internalAccount();
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
                const account = await internalAccount();
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
                    const account = await internalAccount();
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
                    const account = await internalAccount();
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

        describe('update', () => {
            it('should allow the author to update the post', async () => {
                const author = await internalAccount();
                const post = Post.createFromData(author, {
                    type: PostType.Note,
                    content: 'Original content',
                });

                const updateParams: PostUpdateParams = {
                    title: PostTitle.parse('Updated Title'),
                    content: 'Updated content',
                    excerpt: PostSummary.parse('Updated excerpt'),
                    summary: PostSummary.parse('Updated summary'),
                    imageUrl: new URL('https://example.com/updated-image.jpg'),
                    url: new URL('https://example.com/updated-post'),
                    metadata: { ghostAuthors: [] },
                };

                expect(post.isUpdateDirty).toBe(false);

                post.update(author, updateParams);

                expect(post.isUpdateDirty).toBe(true);
            });

            it('should throw an error if someone other than the author tries to update', async () => {
                const author = await internalAccount();
                const notAuthor = await externalAccount();
                const post = Post.createFromData(author, {
                    type: PostType.Note,
                    content: 'Original content',
                });

                const updateParams: PostUpdateParams = {
                    title: PostTitle.parse('Updated Title'),
                    content: 'Updated content',
                    excerpt: PostSummary.parse('Updated excerpt'),
                    summary: PostSummary.parse('Updated summary'),
                    imageUrl: new URL('https://example.com/updated-image.jpg'),
                    url: new URL('https://example.com/updated-post'),
                    metadata: { ghostAuthors: [] },
                };

                expect(() => {
                    post.update(notAuthor, updateParams);
                }).toThrow(
                    `Account ${notAuthor.uuid} cannot update Post ${post.uuid}`,
                );

                expect(post.isUpdateDirty).toBe(false);
            });

            it('should update the post', async () => {
                const author = await internalAccount();
                const post = Post.createFromData(author, {
                    type: PostType.Note,
                    content: 'Original content',
                });

                const updateParams: PostUpdateParams = {
                    title: PostTitle.parse('Updated Title'),
                    content: 'Updated content',
                    excerpt: PostSummary.parse('Updated excerpt'),
                    summary: PostSummary.parse('Updated summary'),
                    imageUrl: new URL('https://example.com/updated-image.jpg'),
                    url: new URL('https://example.com/updated-post'),
                    metadata: { ghostAuthors: [] },
                };

                post.update(author, updateParams);

                expect(post.title).toBe('Updated Title');
                expect(post.content).toBe('Updated content');
                expect(post.excerpt).toBe('Updated excerpt');
                expect(post.summary).toBe('Updated summary');
                expect(post.imageUrl?.href).toBe(
                    'https://example.com/updated-image.jpg',
                );
                expect(post.url.href).toBe('https://example.com/updated-post');
                expect(post.metadata).toEqual({ ghostAuthors: [] });
            });

            it('should clear the update dirty flag when clearDirtyFlags is called', async () => {
                const author = await internalAccount();
                const post = Post.createFromData(author, {
                    type: PostType.Note,
                    content: 'Original content',
                });

                const updateParams: PostUpdateParams = {
                    title: PostTitle.parse('Updated Title'),
                    content: 'Updated content',
                    excerpt: PostSummary.parse('Updated excerpt'),
                    summary: PostSummary.parse('Updated summary'),
                    imageUrl: new URL('https://example.com/updated-image.jpg'),
                    url: new URL('https://example.com/updated-post'),
                    metadata: { ghostAuthors: [] },
                };

                post.update(author, updateParams);

                // First call should return the params
                expect(post.isUpdateDirty).toBe(true);

                post.clearDirtyFlags();

                // Second call should return null since params were cleared
                expect(post.isUpdateDirty).toBe(false);
            });

            it('should return null if no update parameters are stored', async () => {
                const author = await internalAccount();
                const post = Post.createFromData(author, {
                    type: PostType.Note,
                    content: 'Original content',
                });

                expect(post.isUpdateDirty).toBe(false);
            });
        });
    });

    describe('createFromData', () => {
        it('creates a post of type note', async () => {
            const account = await internalAccount();
            const postData = {
                type: PostType.Note,
                content: 'This is a test note',
            } as PostData;

            const result = Post.createFromData(account, postData);

            expect(result).toBeInstanceOf(Post);
            expect(result.content).toBe('This is a test note');
        });

        it('creates a post with summary', async () => {
            const account = await internalAccount();
            const postData = {
                type: PostType.Article,
                title: 'Test Article',
                content: 'This is a test article with a lot of content',
                excerpt: 'This is a test article...',
                summary: 'This is a custom summary',
            } as PostData;

            const result = Post.createFromData(account, postData);

            expect(result).toBeInstanceOf(Post);
            expect(result.title).toBe('Test Article');
            expect(result.excerpt).toBe('This is a test article...');
            expect(result.summary).toBe('This is a custom summary');
        });

        it('attaches mentions to the post but should not modify content with no hyperlink', async () => {
            const account = await internalAccount();
            const extAccount = await externalAccount();
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
            const account = await internalAccount();
            const extAccount = await externalAccount();
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

    describe('setLikeCount', () => {
        it('should throw an error if the post is internal', async () => {
            const author = await internalAccount();
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

            expect(() => post.setLikeCount(10)).toThrow(
                'setLikeCount() can only be used for external posts. Use addLike() for internal posts instead.',
            );
        });

        it('should set the like count for an external post', async () => {
            const author = await externalAccount();
            const apId = new URL('https://example.com/post');

            const post = Post.createFromData(author, {
                type: PostType.Note,
                content: 'This is a test note',
                apId,
            });

            post.setLikeCount(10);

            expect(post.likeCount).toBe(10);
        });
    });

    describe('setRepostCount', () => {
        it('should throw an error if the post is internal', async () => {
            const account = await internalAccount();
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

            expect(() => post.setRepostCount(10)).toThrow(
                'setRepostCount() can only be used for external posts. Use addRepost() for internal posts instead.',
            );
        });

        it('should set the repost count for an external post', async () => {
            const author = await externalAccount();
            const apId = new URL('https://example.com/post');

            const post = Post.createFromData(author, {
                type: PostType.Note,
                content: 'This is a test note',
                apId,
            });

            post.setRepostCount(10);

            expect(post.repostCount).toBe(10);
        });
    });

    describe('dirty flags', () => {
        describe('setLikeCount with dirty flag', () => {
            it('should set the dirty flag when like count is changed', async () => {
                const author = await externalAccount();
                const apId = new URL('https://example.com/post');

                const post = Post.createFromData(author, {
                    type: PostType.Note,
                    content: 'This is a test note',
                    apId,
                });

                expect(post.isLikeCountDirty).toBe(false);

                post.setLikeCount(10);

                expect(post.isLikeCountDirty).toBe(true);
                expect(post.likeCount).toBe(10);
            });

            it('should clear dirty flag when clearDirtyFlags is called', async () => {
                const author = await externalAccount();
                const apId = new URL('https://example.com/post');

                const post = Post.createFromData(author, {
                    type: PostType.Note,
                    content: 'This is a test note',
                    apId,
                });

                post.setLikeCount(10);
                expect(post.isLikeCountDirty).toBe(true);

                post.clearDirtyFlags();

                expect(post.isLikeCountDirty).toBe(false);
                expect(post.likeCount).toBe(10); // Count should remain unchanged
            });
        });

        describe('setRepostCount with dirty flag', () => {
            it('should set the dirty flag when repost count is changed', async () => {
                const author = await externalAccount();
                const apId = new URL('https://example.com/post');

                const post = Post.createFromData(author, {
                    type: PostType.Note,
                    content: 'This is a test note',
                    apId,
                });

                expect(post.isRepostCountDirty).toBe(false);

                post.setRepostCount(5);

                expect(post.isRepostCountDirty).toBe(true);
                expect(post.repostCount).toBe(5);
            });

            it('should clear dirty flag when clearDirtyFlags is called', async () => {
                const author = await externalAccount();
                const apId = new URL('https://example.com/post');

                const post = Post.createFromData(author, {
                    type: PostType.Note,
                    content: 'This is a test note',
                    apId,
                });

                post.setRepostCount(5);
                expect(post.isRepostCountDirty).toBe(true);

                post.clearDirtyFlags();

                expect(post.isRepostCountDirty).toBe(false);
                expect(post.repostCount).toBe(5); // Count should remain unchanged
            });
        });

        describe('clearDirtyFlags', () => {
            it('should clear both like and repost dirty flags', async () => {
                const author = await externalAccount();
                const apId = new URL('https://example.com/post');

                const post = Post.createFromData(author, {
                    type: PostType.Note,
                    content: 'This is a test note',
                    apId,
                });

                post.setLikeCount(10);
                post.setRepostCount(5);

                expect(post.isLikeCountDirty).toBe(true);
                expect(post.isRepostCountDirty).toBe(true);

                post.clearDirtyFlags();

                expect(post.isLikeCountDirty).toBe(false);
                expect(post.isRepostCountDirty).toBe(false);
                expect(post.likeCount).toBe(10);
                expect(post.repostCount).toBe(5);
            });
        });
    });
});
