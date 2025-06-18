import {
    Article,
    Create,
    Note as FedifyNote,
    type Object as FedifyObject,
} from '@fedify/fedify';
import { AccountEntity } from 'account/account.entity';
import type { UriBuilder } from 'activitypub/uri';
import type { FedifyContext } from 'app';
import { Post, PostType } from 'post/post.entity';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCreateActivityAndObjectFromPost } from './activity';

vi.mock('@js-temporal/polyfill', async () => {
    const original = await import('@js-temporal/polyfill');

    return {
        Temporal: {
            ...original.Temporal,
            Now: {
                // Return a fixed instant for deterministic testing
                instant: vi
                    .fn()
                    .mockReturnValue(
                        original.Temporal.Instant.from('2025-01-17T10:30:00Z'),
                    ),
            },
        },
    };
});

describe('buildCreateActivityAndObjectFromPost', () => {
    let context: FedifyContext;
    let mockUriBuilder: UriBuilder<FedifyObject>;
    beforeEach(() => {
        mockUriBuilder = {
            buildObjectUri: vi.fn().mockImplementation((object, { id }) => {
                return new URL(
                    `https://example.com/${object.name.toLowerCase()}/${id}`,
                );
            }),
            buildFollowersCollectionUri: vi
                .fn()
                .mockImplementation((handle) => {
                    return new URL(
                        `https://example.com/user/${handle}/followers`,
                    );
                }),
        } as UriBuilder<FedifyObject>;

        context = {
            getObjectUri: mockUriBuilder.buildObjectUri,
            data: {
                globaldb: {
                    set: vi.fn(),
                },
            },
        } as unknown as FedifyContext;
    });

    it('should build a Note activity and object for a Note post', async () => {
        const author = Object.create(AccountEntity);
        author.id = 123;
        author.username = 'testuser';
        author.apId = new URL('https://example.com/user/foo');
        author.apFollowers = new URL('https://example.com/user/foo/followers');

        const post = Object.create(Post);
        post.id = 'post-123';
        post.author = author;
        post.type = PostType.Note;
        post.content = 'Note content';
        post.apId = new URL('https://example.com/note/post-123');
        post.mentions = [];
        post.uuid = 'cb1e7e92-5560-4ceb-9272-7e9d0e2a7da4';

        const result = await buildCreateActivityAndObjectFromPost(
            post,
            context,
        );

        expect(result.createActivity).toBeInstanceOf(Create);
        expect(result.fedifyObject).toBeInstanceOf(FedifyNote);

        const createJsonLd = await result.createActivity.toJsonLd();
        await expect(createJsonLd).toMatchFileSnapshot(
            './__snapshots__/note-create-activity.json',
        );

        const noteJsonLd = await result.fedifyObject.toJsonLd();
        await expect(noteJsonLd).toMatchFileSnapshot(
            './__snapshots__/note-object.json',
        );
    });

    it('should include mentions in the Note activity and object', async () => {
        const author = Object.create(AccountEntity);
        author.id = 123;
        author.username = 'testuser';
        author.apId = new URL('https://example.com/user/foo');
        author.apFollowers = new URL('https://example.com/user/foo/followers');

        const mentionedAccount = Object.create(AccountEntity);
        mentionedAccount.id = 456;
        mentionedAccount.username = 'test';
        mentionedAccount.apId = new URL('https://example.com/@test');

        const post = Object.create(Post);
        post.id = 'post-123';
        post.author = author;
        post.type = PostType.Note;
        post.content = 'Hello! @test@example.com';
        post.apId = new URL('https://example.com/note/post-123');
        post.mentions = [mentionedAccount];
        post.uuid = 'cb1e7e92-5560-4ceb-9272-7e9d0e2a7da4';

        const result = await buildCreateActivityAndObjectFromPost(
            post,
            context,
        );

        expect(result.createActivity).toBeInstanceOf(Create);
        expect(result.fedifyObject).toBeInstanceOf(FedifyNote);

        const createJsonLd = await result.createActivity.toJsonLd();
        await expect(createJsonLd).toMatchFileSnapshot(
            './__snapshots__/note-with-mentions-create-activity.json',
        );

        const noteJsonLd = await result.fedifyObject.toJsonLd();
        await expect(noteJsonLd).toMatchFileSnapshot(
            './__snapshots__/note-with-mentions-object.json',
        );
    });

    it('should include image attachments in the Note activity and object', async () => {
        const author = Object.create(AccountEntity);
        author.id = 123;
        author.username = 'testuser';
        author.apId = new URL('https://example.com/user/foo');
        author.apFollowers = new URL('https://example.com/user/foo/followers');

        const post = Object.create(Post);
        post.id = 'post-123';
        post.author = author;
        post.type = PostType.Note;
        post.content = 'Note with image';
        post.apId = new URL('https://example.com/note/post-123');
        post.mentions = [];
        post.uuid = 'cb1e7e92-5560-4ceb-9272-7e9d0e2a7da4';
        post.attachments = [
            {
                type: 'Image',
                mediaType: 'image/jpeg',
                name: 'test.jpg',
                url: new URL('https://example.com/images/test.jpg'),
            },
        ];

        const result = await buildCreateActivityAndObjectFromPost(
            post,
            context,
        );

        expect(result.createActivity).toBeInstanceOf(Create);
        expect(result.fedifyObject).toBeInstanceOf(FedifyNote);

        const createJsonLd = await result.createActivity.toJsonLd();
        await expect(createJsonLd).toMatchFileSnapshot(
            './__snapshots__/note-with-image-create-activity.json',
        );

        const noteJsonLd = await result.fedifyObject.toJsonLd();
        await expect(noteJsonLd).toMatchFileSnapshot(
            './__snapshots__/note-with-image-object.json',
        );
    });

    it('should build an Article activity and object for an Article post', async () => {
        const author = Object.create(AccountEntity);
        author.id = 123;
        author.username = 'testuser';
        author.apId = new URL('https://example.com/user/foo');
        author.apFollowers = new URL('https://example.com/user/foo/followers');

        const post = Object.create(Post);
        post.id = 'post-123';
        post.author = author;
        post.type = PostType.Article;
        post.title = 'Post title';
        post.content = 'Post content';
        post.excerpt = 'Post excerpt';
        post.imageUrl = new URL('https://example.com/img/post-123_feature.jpg');
        post.publishedAt = new Date('2025-01-12T10:30:00Z');
        post.url = new URL('https://example.com/post/post-123');
        post.apId = new URL('https://example.com/article/post-123');
        post.uuid = 'cb1e7e92-5560-4ceb-9272-7e9d0e2a7da4';

        const result = await buildCreateActivityAndObjectFromPost(
            post,
            context,
        );

        expect(result.createActivity).toBeInstanceOf(Create);
        expect(result.fedifyObject).toBeInstanceOf(Article);

        const createJsonLd = await result.createActivity.toJsonLd();
        await expect(createJsonLd).toMatchFileSnapshot(
            './__snapshots__/article-create-activity.json',
        );

        const articleJsonLd = await result.fedifyObject.toJsonLd();
        await expect(articleJsonLd).toMatchFileSnapshot(
            './__snapshots__/article-object.json',
        );
    });

    it('should throw an error for unsupported post types', async () => {
        const author = Object.create(AccountEntity);
        author.id = 123;
        author.username = 'testuser';
        author.apId = new URL('https://example.com/user/foo');

        const post = Object.create(Post);
        post.author = author;
        post.type = 5;
        post.apId = new URL('https://example.com/post/123');

        await expect(
            buildCreateActivityAndObjectFromPost(post, context),
        ).rejects.toThrow('Unsupported post type: 5');
    });
});
