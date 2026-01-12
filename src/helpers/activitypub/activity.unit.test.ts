import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    Announce,
    Article,
    Create,
    Note as FedifyNote,
    type Object as FedifyObject,
    Update,
} from '@fedify/fedify';

import { AccountEntity } from '@/account/account.entity';
import type { UriBuilder } from '@/activitypub/uri';
import type { FedifyContext } from '@/app';
import {
    buildAnnounceActivityForPost,
    buildCreateActivityAndObjectFromPost,
    buildUpdateActivityAndObjectFromPost,
} from '@/helpers/activitypub/activity';
import { Audience, Post, PostType } from '@/post/post.entity';
import {
    createTestExternalAccount,
    createTestInternalAccount,
} from '@/test/account-entity-test-helpers';

vi.mock('node:crypto', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:crypto')>();
    return {
        ...actual,
        randomUUID: vi.fn(() => 'cb1e7e92-5560-4ceb-9272-7e9d0e2a7da4'),
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
            post.publishedAt = new Date('2025-01-01T00:00:00Z');
            post.updatedAt = new Date('2025-01-15T00:00:00Z');

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
            post.publishedAt = new Date('2025-01-01T00:00:00Z');

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
            post.publishedAt = new Date('2025-01-01T00:00:00Z');
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
            post.updatedAt = new Date('2025-01-15T10:30:00Z');
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
            post.publishedAt = new Date('2025-01-12T10:30:00Z');

            await expect(
                buildCreateActivityAndObjectFromPost(post, context),
            ).rejects.toThrow('Unsupported post type: 5');
        });
    });

    describe('buildUpdateActivityAndObjectFromPost', () => {
        it('should build an Update activity and Note object for a Note post', async () => {
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
            post.content = 'Updated note content';
            post.apId = new URL('https://example.com/note/post-123');
            post.mentions = [];
            post.uuid = 'cb1e7e92-5560-4ceb-9272-7e9d0e2a7da4';
            post.publishedAt = new Date('2025-01-01T00:00:00Z');

            const result = await buildUpdateActivityAndObjectFromPost(
                post,
                context,
            );

            expect(result.updateActivity).toBeInstanceOf(Update);
            expect(result.fedifyObject).toBeInstanceOf(FedifyNote);

            const updateJsonLd = await result.updateActivity.toJsonLd();
            await expect(updateJsonLd).toMatchFileSnapshot(
                './__snapshots__/note-update-activity.json',
            );
        });

        it('should build an Update activity and Article object for an Article post', async () => {
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
            post.title = 'Updated post title';
            post.content = 'Updated post content';
            post.excerpt = 'Updated post excerpt';
            post.imageUrl = new URL(
                'https://example.com/img/post-123_updated_feature.jpg',
            );
            post.publishedAt = new Date('2025-01-12T10:30:00Z');
            post.url = new URL('https://example.com/post/post-123');
            post.apId = new URL('https://example.com/article/post-123');
            post.uuid = 'cb1e7e92-5560-4ceb-9272-7e9d0e2a7da4';

            const result = await buildUpdateActivityAndObjectFromPost(
                post,
                context,
            );

            expect(result.updateActivity).toBeInstanceOf(Update);
            expect(result.fedifyObject).toBeInstanceOf(Article);

            const updateJsonLd = await result.updateActivity.toJsonLd();
            await expect(updateJsonLd).toMatchFileSnapshot(
                './__snapshots__/article-update-activity.json',
            );
        });
    });

    describe('buildAnnounceActivityForPost', () => {
        let account: AccountEntity;
        let author: AccountEntity;
        let post: Post;

        beforeEach(async () => {
            account = await createTestExternalAccount(123, {
                username: 'testuser',
                name: 'Test User',
                bio: 'Test bio',
                url: new URL('https://example.com/user/testuser'),
                avatarUrl: null,
                bannerImageUrl: null,
                customFields: null,
                apId: new URL('https://example.com/user/testuser'),
                apFollowers: new URL(
                    'https://example.com/user/testuser/followers',
                ),
                apInbox: new URL('https://example.com/user/testuser/inbox'),
            });

            author = await createTestInternalAccount(456, {
                host: new URL('https://example.com'),
                username: 'author',
                name: 'Author',
                bio: null,
                url: new URL('https://example.com/user/author'),
                avatarUrl: null,
                bannerImageUrl: null,
                customFields: null,
            });

            post = Post.createFromData(author, {
                type: PostType.Note,
                audience: Audience.Public,
                content: 'Test post content',
            });
        });

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
            const articlePost = Post.createFromData(author, {
                type: PostType.Article,
                audience: Audience.Public,
                content: 'Test article content',
            });

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
