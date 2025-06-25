import {
    Announce,
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
import {
    buildAnnounceActivityForPost,
    buildCreateActivityAndObjectFromPost,
} from './activity';

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

describe('Build activity', () => {
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

    describe('buildCreateActivityAndObjectFromPost', () => {
        it('should build a Note activity and object for a Note post', async () => {
            const author = Object.create(AccountEntity);
            author.id = 123;
            author.username = 'testuser';
            author.apId = new URL('https://example.com/user/foo');
            author.apFollowers = new URL(
                'https://example.com/user/foo/followers',
            );

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
            author.apFollowers = new URL(
                'https://example.com/user/foo/followers',
            );

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
            author.apFollowers = new URL(
                'https://example.com/user/foo/followers',
            );

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
                    name: 'alt text for image',
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
            author.apFollowers = new URL(
                'https://example.com/user/foo/followers',
            );

            const post = Object.create(Post);
            post.id = 'post-123';
            post.author = author;
            post.type = PostType.Article;
            post.title = 'Post title';
            post.content = 'Post content';
            post.excerpt = 'Post excerpt';
            post.imageUrl = new URL(
                'https://example.com/img/post-123_feature.jpg',
            );
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

    describe('buildAnnounceActivityForPost', () => {
        const account = AccountEntity.create({
            id: 123,
            uuid: 'test-uuid-123',
            username: 'testuser',
            name: 'Test User',
            bio: 'Test bio',
            url: new URL('https://example.com/user/testuser'),
            avatarUrl: null,
            bannerImageUrl: null,
            apId: new URL('https://example.com/user/testuser'),
            apFollowers: new URL('https://example.com/user/testuser/followers'),
            apInbox: new URL('https://example.com/user/testuser/inbox'),
            isInternal: false,
        });

        const author = AccountEntity.create({
            id: 456,
            uuid: 'author-uuid-456',
            username: 'author',
            name: 'Author',
            bio: null,
            url: new URL('https://example.com/user/author'),
            avatarUrl: null,
            bannerImageUrl: null,
            apId: new URL('https://example.com/user/author'),
            apFollowers: new URL('https://example.com/user/author/followers'),
            apInbox: new URL('https://example.com/user/author/inbox'),
            isInternal: false,
        });

        const post = new Post(
            123,
            'cb1e7e92-5560-4ceb-9272-7e9d0e2a7da4',
            author,
            PostType.Note,
            0,
            null,
            null,
            null,
            'Test post content',
            new URL('https://example.com/note/post-123'),
            null,
            new Date('2025-01-17T10:30:00Z'),
            null,
            0,
            0,
            0,
            null,
            null,
            null,
            [],
            new URL('https://example.com/note/post-123'),
            false,
            null,
        );

        it('should build an Announce activity with correct properties', async () => {
            const result = await buildAnnounceActivityForPost(
                account,
                post,
                context,
            );

            expect(result).toBeInstanceOf(Announce);
            expect(result.actorId).toBe(account.apId);
            expect(result.objectId).toBe(post.apId);
            expect(result.id).toBeDefined();
        });

        it('should serialize to valid JSON-LD', async () => {
            const result = await buildAnnounceActivityForPost(
                account,
                post,
                context,
            );

            const jsonLd = await result.toJsonLd();

            expect(jsonLd).toHaveProperty('@context');
            expect(jsonLd).toHaveProperty('id');
            expect(jsonLd).toHaveProperty('type', 'Announce');
            expect(jsonLd).toHaveProperty('actor', account.apId.href);
            expect(jsonLd).toHaveProperty('object', post.apId.href);
            expect(jsonLd).toHaveProperty('to');
            expect(jsonLd).toHaveProperty('cc', account.apFollowers?.href);
        });

        it('should build an Announce activity with correct properties for an Article', async () => {
            const articlePost = new Post(
                123,
                'cb1e7e92-5560-4ceb-9272-7e9d0e2a7da4',
                post.author,
                PostType.Article,
                0,
                'Test Article Title',
                'Test excerpt',
                'Test summary',
                'Test article content',
                new URL('https://example.com/article/post-123'),
                new URL('https://example.com/img/post-123_feature.jpg'),
                new Date('2025-01-17T10:30:00Z'),
                null,
                0,
                0,
                0,
                null,
                null,
                null,
                [],
                new URL('https://example.com/article/post-123'),
                false,
                null,
            );

            const result = await buildAnnounceActivityForPost(
                account,
                articlePost,
                context,
            );

            expect(result).toBeInstanceOf(Announce);
            expect(result.objectId).toBe(articlePost.apId);
        });
    });
});
