import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Knex } from 'knex';

import type { Account } from '@/account/account.entity';
import type { FedifyContextFactory } from '@/activitypub/fedify-context.factory';
import { normalizePlainText } from '@/helpers/html';
import { AccountPostsView } from '@/http/api/views/account.posts.view';
import { PostType } from '@/post/post.entity';

// Mock the fedify modules
vi.mock('@fedify/vocab', () => ({
    isActor: vi.fn(),
    lookupObject: vi.fn(),
    Activity: class MockActivity {
        getObject = () => undefined as unknown;
        toJsonLd = () => undefined as unknown;
    },
    CollectionPage: class MockCollectionPage {
        constructor(
            public items: unknown[],
            public nextId: string | null,
        ) {}
        async getItems() {
            return this.items;
        }
    },
}));

// Mock the content helpers
vi.mock('@/helpers/html', () => ({
    sanitizeHtml: vi.fn((content: string) => `${content} [sanitized]`),
    normalizePlainText: vi.fn((content: string) => content),
}));

vi.mock('@/post/content', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/post/content')>();

    return {
        ContentPreparer: {
            updateMentions: vi.fn(
                (content: string) => `${content} [mentions updated]`,
            ),
            regenerateContentWarning: vi.fn((html: string) => html),
            regenerateExcerpt: vi.fn((html: string) =>
                actual.ContentPreparer.regenerateExcerpt(html),
            ),
        },
    };
});

describe('Account Posts View', () => {
    let view: AccountPostsView;
    let db: Knex;
    let fedifyContextFactory: FedifyContextFactory;

    beforeEach(() => {
        vi.clearAllMocks();

        db = {
            select: vi.fn(),
            from: vi.fn(),
            where: vi.fn(),
            orderBy: vi.fn(),
            limit: vi.fn(),
            offset: vi.fn(),
        } as unknown as Knex;
        fedifyContextFactory = {
            getFedifyContext: vi.fn(),
        } as unknown as FedifyContextFactory;
        view = new AccountPostsView(db, fedifyContextFactory);
    });

    describe('mapActivityToPostDTO', () => {
        it('should map a regular post activity to PostDTO', () => {
            const activity = {
                type: 'Create',
                object: {
                    id: 'https://example.com/posts/123',
                    type: 'Note',
                    name: 'Test Post',
                    content: 'Test Content',
                    url: 'https://example.com/posts/123',
                    image: 'https://example.com/image.jpg',
                    published: '2024-03-20T12:00:00Z',
                    liked: true,
                    likeCount: 7,
                    replyCount: 5,
                    attachment: [],
                    authored: true,
                    reposted: false,
                    repostCount: 0,
                    attributedTo: {
                        id: 'https://example.com/users/1',
                        name: 'Test User',
                        preferredUsername: 'testuser',
                        icon: { url: 'https://example.com/avatar.jpg' },
                    },
                },
                actor: {
                    id: 'https://example.com/users/1',
                    name: 'Test User',
                    preferredUsername: 'testuser',
                    icon: { url: 'https://example.com/avatar.jpg' },
                },
            };

            const result = view.mapActivityToPostDTO(activity);

            expect(normalizePlainText).toHaveBeenCalledTimes(1);
            expect(normalizePlainText).toHaveBeenCalledWith('Test Post');

            expect(result).toEqual({
                id: 'https://example.com/posts/123',
                type: PostType.Note,
                title: 'Test Post',
                excerpt: '',
                summary: null,
                sensitive: false,
                contentWarning: null,
                content: 'Test Content',
                url: 'https://example.com/posts/123',
                featureImageUrl: 'https://example.com/image.jpg',
                publishedAt: new Date('2024-03-20T12:00:00Z'),
                likeCount: 7,
                likedByMe: true,
                replyCount: 5,
                readingTimeMinutes: 0,
                attachments: [],
                author: {
                    id: 'https://example.com/users/1',
                    handle: '@testuser@example.com',
                    name: 'Test User',
                    url: 'https://example.com/users/1',
                    avatarUrl: 'https://example.com/avatar.jpg',
                    followedByMe: false,
                },
                authoredByMe: true,
                repostCount: 0,
                repostedByMe: false,
                repostedBy: null,
            });
        });

        it('should map followedByMe from attributedTo in regular posts', () => {
            const activity = {
                type: 'Create',
                object: {
                    id: 'https://example.com/posts/123',
                    type: 'Note',
                    name: 'Test Post',
                    content: 'Test Content',
                    url: 'https://example.com/posts/123',
                    published: '2024-03-20T12:00:00Z',
                    attachment: [],
                    attributedTo: {
                        id: 'https://example.com/users/1',
                        name: 'Test User',
                        preferredUsername: 'testuser',
                        icon: { url: 'https://example.com/avatar.jpg' },
                        followedByMe: true,
                    },
                },
                actor: {
                    id: 'https://example.com/users/1',
                    name: 'Test User',
                    preferredUsername: 'testuser',
                },
            };

            const result = view.mapActivityToPostDTO(activity);

            expect(result.author.followedByMe).toBe(true);
        });

        it('should map a repost activity to PostDTO', () => {
            const activity = {
                type: 'Announce',
                object: {
                    id: 'https://example.com/posts/123',
                    type: 'Note',
                    name: 'Original Post',
                    content: 'Original Content',
                    url: 'https://example.com/posts/123',
                    image: 'https://example.com/image.jpg',
                    published: '2024-03-20T12:00:00Z',
                    liked: false,
                    replyCount: 3,
                    attachment: [],
                    authored: false,
                    reposted: true,
                    repostCount: 1,
                    attributedTo: {
                        id: 'https://example.com/users/1',
                        name: 'Original Author',
                        preferredUsername: 'originalauthor',
                        icon: { url: 'https://example.com/avatar1.jpg' },
                    },
                },
                actor: {
                    id: 'https://example.com/users/2',
                    name: 'Reposter',
                    preferredUsername: 'reposter',
                    icon: { url: 'https://example.com/avatar2.jpg' },
                },
            };

            const result = view.mapActivityToPostDTO(activity);

            expect(result).toEqual({
                id: 'https://example.com/posts/123',
                type: PostType.Note,
                title: 'Original Post',
                excerpt: '',
                summary: null,
                sensitive: false,
                contentWarning: null,
                content: 'Original Content',
                url: 'https://example.com/posts/123',
                featureImageUrl: 'https://example.com/image.jpg',
                publishedAt: new Date('2024-03-20T12:00:00Z'),
                likeCount: 0,
                likedByMe: false,
                replyCount: 3,
                readingTimeMinutes: 0,
                attachments: [],
                author: {
                    id: 'https://example.com/users/1',
                    handle: '@originalauthor@example.com',
                    name: 'Original Author',
                    url: 'https://example.com/users/1',
                    avatarUrl: 'https://example.com/avatar1.jpg',
                    followedByMe: false,
                },
                authoredByMe: false,
                repostCount: 1,
                repostedByMe: true,
                repostedBy: {
                    id: 'https://example.com/users/2',
                    handle: '@reposter@example.com',
                    name: 'Reposter',
                    url: 'https://example.com/users/2',
                    avatarUrl: 'https://example.com/avatar2.jpg',
                    followedByMe: false,
                },
            });
        });

        it('should map followedByMe for both author and reposter in reposts', () => {
            const activity = {
                type: 'Announce',
                object: {
                    id: 'https://example.com/posts/123',
                    type: 'Note',
                    content: 'Original Content',
                    url: 'https://example.com/posts/123',
                    published: '2024-03-20T12:00:00Z',
                    attachment: [],
                    attributedTo: {
                        id: 'https://example.com/users/1',
                        name: 'Original Author',
                        preferredUsername: 'originalauthor',
                        icon: { url: 'https://example.com/avatar1.jpg' },
                        followedByMe: true,
                    },
                },
                actor: {
                    id: 'https://example.com/users/2',
                    name: 'Reposter',
                    preferredUsername: 'reposter',
                    icon: { url: 'https://example.com/avatar2.jpg' },
                    followedByMe: true,
                },
            };

            const result = view.mapActivityToPostDTO(activity);

            expect(result.author.followedByMe).toBe(true);
            expect(result.repostedBy?.followedByMe).toBe(true);
        });

        it('should map sensitive and content warning from remote post activities', () => {
            const activity = {
                type: 'Create',
                object: {
                    id: 'https://example.com/posts/123',
                    type: 'Note',
                    summary: 'Sensitive topic',
                    sensitive: true,
                    content: 'Test Content',
                    url: 'https://example.com/posts/123',
                    published: '2024-03-20T12:00:00Z',
                    attachment: [],
                    attributedTo: {
                        id: 'https://example.com/users/1',
                        name: 'Test User',
                        preferredUsername: 'testuser',
                    },
                },
                actor: {
                    id: 'https://example.com/users/1',
                    name: 'Test User',
                    preferredUsername: 'testuser',
                },
            };

            const result = view.mapActivityToPostDTO(activity);

            expect(result).toMatchObject({
                sensitive: true,
                summary: null,
                contentWarning: 'Sensitive topic',
            });
        });
        it('should map the HTML summary of a remote post to plain text', () => {
            const activity = {
                type: 'Create',
                object: {
                    id: 'https://write.as/api/posts/o4ft5n5dic3alawl',
                    type: 'Article',
                    name: 'Coming soon: Read.as for Android',
                    summary:
                        '<p>I&#39;ve been working on some Android apps <a href="https://example.com" rel="nofollow ugc">for WriteFreely</a> lately.</p>\n\n<p> [...]</p>',
                    content: '<p>Full content</p>',
                    url: 'https://write.as/matt/coming-soon-read-as-for-android',
                    published: '2024-03-20T12:00:00Z',
                    attachment: [],
                    attributedTo: {
                        id: 'https://write.as/api/collections/matt',
                        name: 'Matt',
                        preferredUsername: 'matt',
                    },
                },
                actor: {
                    id: 'https://write.as/api/collections/matt',
                    name: 'Matt',
                    preferredUsername: 'matt',
                },
            };

            const result = view.mapActivityToPostDTO(activity);

            expect(result.summary).toMatch(
                /^I've been working on some Android apps for WriteFreely lately\.\s+\[\.\.\.\]$/,
            );
            expect(result.contentWarning).toBeNull();
        });

        describe('remote summaries and previews', () => {
            const mapRemoteArticle = (object: Record<string, unknown>) =>
                view.mapActivityToPostDTO({
                    type: 'Create',
                    object: {
                        id: 'https://example.com/posts/123',
                        type: 'Article',
                        name: 'Test Article',
                        content: '<p>Full content</p>',
                        url: 'https://example.com/posts/123',
                        published: '2024-03-20T12:00:00Z',
                        attachment: [],
                        attributedTo: {
                            id: 'https://example.com/users/1',
                            name: 'Test User',
                            preferredUsername: 'testuser',
                        },
                        ...object,
                    },
                    actor: {
                        id: 'https://example.com/users/1',
                        name: 'Test User',
                        preferredUsername: 'testuser',
                    },
                });

            it('should use the first value of a summary with several values', () => {
                const result = mapRemoteArticle({
                    summary: ['<p>First summary</p>', '<p>Second summary</p>'],
                });

                expect(result.summary).toBe('First summary');
            });

            it('should use the first value of a content warning with several values', () => {
                const result = mapRemoteArticle({
                    sensitive: true,
                    summary: ['First warning', 'Second warning'],
                });

                expect(result.summary).toBeNull();
                expect(result.contentWarning).toBe('First warning');
            });

            it('should map a summary that is not a string to null', () => {
                const result = mapRemoteArticle({
                    summary: { '@value': '<p>Summary</p>', '@language': 'en' },
                });

                expect(result.summary).toBeNull();
            });

            it('should map a summary without any text to null', () => {
                const result = mapRemoteArticle({
                    summary: '<p><img src="https://example.com/image.jpg"></p>',
                });

                expect(result.summary).toBeNull();
            });

            it('should map the HTML preview of a remote post to a plain text excerpt', () => {
                const result = mapRemoteArticle({
                    preview: {
                        type: 'Note',
                        content:
                            '<p>Tom &amp; Jerry <a href="https://example.com">return</a></p>',
                    },
                });

                expect(result.excerpt).toBe('Tom & Jerry return');
            });

            it('should use the first value of a preview with several values', () => {
                const result = mapRemoteArticle({
                    preview: {
                        type: 'Note',
                        content: [
                            '<p>First preview</p>',
                            '<p>Second preview</p>',
                        ],
                    },
                });

                expect(result.excerpt).toBe('First preview');
            });

            it('should map a missing preview to an empty excerpt', () => {
                const result = mapRemoteArticle({});

                expect(result.excerpt).toBe('');
            });
        });
    });

    describe('getPostsByRemoteLookUp', () => {
        let mockDb: ReturnType<typeof vi.fn>;
        let mockFedifyContext: {
            getDocumentLoader: ReturnType<typeof vi.fn>;
        };
        let mockDocumentLoader: ReturnType<typeof vi.fn>;
        let mockActor: {
            id: URL;
            toJsonLd: ReturnType<typeof vi.fn>;
            getOutbox: ReturnType<typeof vi.fn>;
        };
        let mockOutbox: {
            getFirst: ReturnType<typeof vi.fn>;
        };
        let mockPage: {
            getItems: ReturnType<typeof vi.fn>;
            nextId: string | null;
        };
        let isActor: ReturnType<typeof vi.fn>;
        let lookupObject: ReturnType<typeof vi.fn>;
        let sanitizeHtml: ReturnType<typeof vi.fn>;
        let ContentPreparer: {
            updateMentions: ReturnType<typeof vi.fn>;
        };

        beforeEach(async () => {
            // Reset all mocks
            vi.clearAllMocks();

            // Get mocked modules
            const fedifyModule = await vi.importMock('@fedify/vocab');
            const htmlModule = await vi.importMock('@/helpers/html');
            const contentModule = await vi.importMock('@/post/content');

            isActor = (fedifyModule as { isActor: typeof isActor }).isActor;
            lookupObject = (
                fedifyModule as { lookupObject: typeof lookupObject }
            ).lookupObject;
            sanitizeHtml = (htmlModule as { sanitizeHtml: typeof sanitizeHtml })
                .sanitizeHtml;
            ContentPreparer = (
                contentModule as { ContentPreparer: typeof ContentPreparer }
            ).ContentPreparer;

            // Setup database mock
            mockDb = vi.fn(() => ({
                where: vi.fn().mockReturnThis(),
                select: vi.fn().mockReturnThis(),
                whereRaw: vi.fn().mockReturnThis(),
                first: vi.fn(),
            }));
            (mockDb as unknown as { raw: (sql: string) => string }).raw = vi.fn(
                (sql: string) => sql,
            );

            // Setup fedify context and document loader
            mockDocumentLoader = vi.fn();
            mockFedifyContext = {
                getDocumentLoader: vi
                    .fn()
                    .mockResolvedValue(mockDocumentLoader),
            };

            // Setup actor mock
            mockActor = {
                id: new URL('https://example.com/users/profile'),
                toJsonLd: vi.fn().mockResolvedValue({
                    id: 'https://example.com/users/profile',
                    preferredUsername: 'profile',
                    name: 'Profile User',
                }),
                getOutbox: vi.fn(),
            };

            // Setup outbox and page mocks
            mockPage = {
                getItems: vi.fn().mockImplementation(async function* () {
                    // Empty by default
                }),
                nextId: null,
            };
            mockOutbox = {
                getFirst: vi.fn().mockResolvedValue(mockPage),
            };
            mockActor.getOutbox.mockResolvedValue(mockOutbox);

            // Setup mocks
            isActor.mockReturnValue(true);
            lookupObject.mockResolvedValue(mockActor);

            // Create view instance
            const mockFedifyContextFactory = {
                getFedifyContext: vi.fn().mockReturnValue(mockFedifyContext),
            };
            view = new AccountPostsView(
                mockDb as unknown as Knex,
                mockFedifyContextFactory as unknown as FedifyContextFactory,
            );
        });

        it('should set followedByMe to true when current user follows the profile account', async () => {
            // Arrange
            const currentContextAccountId = 1;
            const currentContextAccountApId = new URL(
                'https://example.com/users/current',
            );
            const profileApId = new URL('https://example.com/users/profile');
            const profileAccount = { id: 2 } as Partial<Account>;

            // Mock that current user follows the profile account
            mockDb.mockReturnValueOnce({
                where: vi.fn().mockReturnThis(),
                first: vi
                    .fn()
                    .mockResolvedValue({ follower_id: 1, following_id: 2 }),
            });

            // Create test activity
            const testObject = {
                id: new URL('https://example.com/posts/1'),
                getAttribution: vi.fn().mockResolvedValue(mockActor),
            };

            // Create an instance of the mocked Activity class
            const fedifyModule = await vi.importMock('@fedify/vocab');
            const ActivityClass = (
                fedifyModule as { Activity: new () => unknown }
            ).Activity;
            const testActivity = Object.create(ActivityClass.prototype);
            testActivity.getObject = vi.fn().mockResolvedValue(testObject);
            testActivity.toJsonLd = vi.fn().mockResolvedValue({
                type: 'Create',
                object: {
                    id: 'https://example.com/posts/1',
                    type: 'Note',
                    content: 'Test post',
                    attributedTo: 'https://example.com/users/profile',
                },
                actor: {
                    id: 'https://example.com/users/profile',
                    preferredUsername: 'profile',
                    name: 'Profile User',
                },
            });

            mockPage.getItems.mockImplementation(async function* () {
                yield testActivity;
            });
            mockOutbox.getFirst.mockResolvedValue(mockPage);

            // Mock getByApId to return null (post not in our DB)
            mockDb.mockReturnValue({
                select: vi.fn().mockReturnThis(),
                whereRaw: vi.fn().mockReturnThis(),
                first: vi.fn().mockResolvedValue(null),
            });

            // Act
            const result = await view.getPostsByRemoteLookUp(
                currentContextAccountId,
                currentContextAccountApId,
                profileApId,
                null,
                profileAccount as Account | null,
            );

            // Assert
            expect(result[0]).toBeNull(); // No error
            expect(result[1]).toBeDefined(); // Has value
            expect(result[1]?.results).toHaveLength(1);
            expect(result[1]?.results[0]).toMatchObject({
                author: expect.objectContaining({
                    followedByMe: true,
                }),
            });
        });

        it('should include the counts we have stored for posts in our database', async () => {
            const currentContextAccountId = 1;
            const currentContextAccountApId = new URL(
                'https://example.com/users/current',
            );
            const profileApId = new URL('https://example.com/users/profile');
            const profileAccount = { id: 2 } as Partial<Account>;

            const rowsByTable: Record<string, unknown> = {
                follows: undefined,
                posts: {
                    id: 10,
                    like_count: 7,
                    reply_count: 2,
                    repost_count: 3,
                },
                likes: { post_id: 10, account_id: 1 },
                reposts: undefined,
            };
            mockDb.mockImplementation((table: string) => ({
                where: vi.fn().mockReturnThis(),
                select: vi.fn().mockReturnThis(),
                whereRaw: vi.fn().mockReturnThis(),
                first: vi.fn().mockResolvedValue(rowsByTable[table]),
            }));

            const testObject = {
                id: new URL('https://example.com/posts/1'),
                getAttribution: vi.fn().mockResolvedValue(mockActor),
            };

            const fedifyModule = await vi.importMock('@fedify/vocab');
            const ActivityClass = (
                fedifyModule as { Activity: new () => unknown }
            ).Activity;
            const testActivity = Object.create(ActivityClass.prototype);
            testActivity.getObject = vi.fn().mockResolvedValue(testObject);
            testActivity.toJsonLd = vi.fn().mockResolvedValue({
                type: 'Create',
                object: {
                    id: 'https://example.com/posts/1',
                    type: 'Note',
                    content: 'Test post',
                    attributedTo: 'https://example.com/users/profile',
                },
                actor: {
                    id: 'https://example.com/users/profile',
                    preferredUsername: 'profile',
                    name: 'Profile User',
                },
            });

            mockPage.getItems.mockImplementation(async function* () {
                yield testActivity;
            });

            const result = await view.getPostsByRemoteLookUp(
                currentContextAccountId,
                currentContextAccountApId,
                profileApId,
                null,
                profileAccount as Account | null,
            );

            expect(result[0]).toBeNull();
            expect(result[1]?.results).toHaveLength(1);
            const post = result[1]?.results[0];
            expect(post?.likeCount).toEqual(7);
            expect(post?.likedByMe).toEqual(true);
            expect(post?.replyCount).toEqual(2);
            expect(post?.repostCount).toEqual(3);
            expect(post?.repostedByMe).toEqual(false);
        });

        it('should set followedByMe to false when current user does not follow the profile account', async () => {
            // Arrange
            const currentContextAccountId = 1;
            const currentContextAccountApId = new URL(
                'https://example.com/users/current',
            );
            const profileApId = new URL('https://example.com/users/profile');
            const profileAccount = { id: 2 } as Partial<Account>;

            // Mock that current user does not follow the profile account
            mockDb.mockReturnValueOnce({
                where: vi.fn().mockReturnThis(),
                first: vi.fn().mockResolvedValue(null),
            });

            // Create test activity
            const testObject = {
                id: new URL('https://example.com/posts/1'),
                getAttribution: vi.fn().mockResolvedValue(mockActor),
            };

            // Create an instance of the mocked Activity class
            const fedifyModule = await vi.importMock('@fedify/vocab');
            const ActivityClass = (
                fedifyModule as { Activity: new () => unknown }
            ).Activity;
            const testActivity = Object.create(ActivityClass.prototype);
            testActivity.getObject = vi.fn().mockResolvedValue(testObject);
            testActivity.toJsonLd = vi.fn().mockResolvedValue({
                type: 'Create',
                object: {
                    id: 'https://example.com/posts/1',
                    type: 'Note',
                    content: 'Test post',
                    attributedTo: 'https://example.com/users/profile',
                },
                actor: {
                    id: 'https://example.com/users/profile',
                    preferredUsername: 'profile',
                    name: 'Profile User',
                },
            });

            mockPage.getItems.mockImplementation(async function* () {
                yield testActivity;
            });
            mockOutbox.getFirst.mockResolvedValue(mockPage);

            // Mock getByApId to return null (post not in our DB)
            mockDb.mockReturnValue({
                select: vi.fn().mockReturnThis(),
                whereRaw: vi.fn().mockReturnThis(),
                first: vi.fn().mockResolvedValue(null),
            });

            // Act
            const result = await view.getPostsByRemoteLookUp(
                currentContextAccountId,
                currentContextAccountApId,
                profileApId,
                null,
                profileAccount as Account | null,
            );

            // Assert
            expect(result[0]).toBeNull(); // No error
            expect(result[1]).toBeDefined(); // Has value
            expect(result[1]?.results).toHaveLength(1);
            expect(result[1]?.results[0]).toMatchObject({
                author: expect.objectContaining({
                    followedByMe: false,
                }),
            });
        });

        it('should set followedByMe correctly for Announce activities when user follows the original author', async () => {
            // Arrange
            const currentContextAccountId = 1;
            const currentContextAccountApId = new URL(
                'https://example.com/users/current',
            );
            const profileApId = new URL('https://example.com/users/reposter');
            const profileAccount = { id: 3 } as Partial<Account>; // The reposter

            // Mock that current user follows the reposter
            mockDb.mockReturnValueOnce({
                where: vi.fn().mockReturnThis(),
                first: vi
                    .fn()
                    .mockResolvedValue({ follower_id: 1, following_id: 3 }),
            });

            // Create test Announce activity
            const testObject = {
                id: new URL('https://example.com/posts/1'),
                getAttribution: vi.fn().mockResolvedValue({
                    id: new URL('https://example.com/users/author'),
                }),
            };

            // Create an instance of the mocked Activity class
            const fedifyModule = await vi.importMock('@fedify/vocab');
            const ActivityClass = (
                fedifyModule as { Activity: new () => unknown }
            ).Activity;
            const testActivity = Object.create(ActivityClass.prototype);
            testActivity.getObject = vi.fn().mockResolvedValue(testObject);
            testActivity.toJsonLd = vi.fn().mockResolvedValue({
                type: 'Announce',
                object: {
                    id: 'https://example.com/posts/1',
                    type: 'Note',
                    content: 'Original post content',
                    attributedTo: 'https://example.com/users/author',
                },
                actor: {
                    id: 'https://example.com/users/reposter',
                    preferredUsername: 'reposter',
                    name: 'Reposter User',
                },
            });

            mockPage.getItems.mockImplementation(async function* () {
                yield testActivity;
            });
            mockOutbox.getFirst.mockResolvedValue(mockPage);

            // Mock getByApId to return null (post not in our DB)
            mockDb.mockReturnValue({
                select: vi.fn().mockReturnThis(),
                whereRaw: vi.fn().mockReturnThis(),
                first: vi.fn().mockResolvedValue(null),
            });

            // Mock getAccountByApId for the original author
            mockDb.mockImplementation((table: string) => {
                if (table === 'accounts') {
                    return {
                        select: vi.fn().mockReturnThis(),
                        whereRaw: vi.fn().mockReturnThis(),
                        first: vi.fn().mockResolvedValue({
                            id: 2,
                            username: 'author',
                            ap_id: 'https://example.com/users/author',
                            url: 'https://example.com/users/author',
                        }),
                    };
                }
                if (table === 'follows') {
                    return {
                        where: vi.fn().mockReturnThis(),
                        first: vi.fn().mockResolvedValue({
                            follower_id: 1,
                            following_id: 2,
                        }),
                    };
                }
                return {
                    select: vi.fn().mockReturnThis(),
                    whereRaw: vi.fn().mockReturnThis(),
                    first: vi.fn().mockResolvedValue(null),
                };
            });

            // Mock lookupObject for attributedTo
            const mockAuthor = {
                id: new URL('https://example.com/users/author'),
                toJsonLd: vi.fn().mockResolvedValue({
                    id: 'https://example.com/users/author',
                    preferredUsername: 'author',
                    name: 'Original Author',
                }),
            };
            lookupObject.mockImplementation(async (url: URL) => {
                if (url.toString().includes('author')) {
                    return mockAuthor;
                }
                return mockActor;
            });
            isActor.mockReturnValue(true);

            // Act
            const result = await view.getPostsByRemoteLookUp(
                currentContextAccountId,
                currentContextAccountApId,
                profileApId,
                null,
                profileAccount as Account | null,
            );

            // Assert
            expect(result[0]).toBeNull(); // No error
            expect(result[1]).toBeDefined(); // Has value
            expect(result[1]?.results).toHaveLength(1);
            expect(result[1]?.results[0]).toMatchObject({
                author: expect.objectContaining({
                    followedByMe: true, // User follows the original author
                }),
                repostedBy: expect.objectContaining({
                    followedByMe: true, // User follows the reposter
                }),
            });
        });

        it('should set followedByMe to false for Announce activities when user does not follow the original author', async () => {
            // Arrange
            const currentContextAccountId = 1;
            const currentContextAccountApId = new URL(
                'https://example.com/users/current',
            );
            const profileApId = new URL('https://example.com/users/reposter');
            const profileAccount = { id: 3 } as Partial<Account>; // The reposter

            // Mock that current user follows the reposter but not the original author
            mockDb.mockReturnValueOnce({
                where: vi.fn().mockReturnThis(),
                first: vi
                    .fn()
                    .mockResolvedValue({ follower_id: 1, following_id: 3 }),
            });

            // Create test Announce activity
            const testObject = {
                id: new URL('https://example.com/posts/1'),
                getAttribution: vi.fn().mockResolvedValue({
                    id: new URL('https://example.com/users/author'),
                }),
            };

            // Create an instance of the mocked Activity class
            const fedifyModule = await vi.importMock('@fedify/vocab');
            const ActivityClass = (
                fedifyModule as { Activity: new () => unknown }
            ).Activity;
            const testActivity = Object.create(ActivityClass.prototype);
            testActivity.getObject = vi.fn().mockResolvedValue(testObject);
            testActivity.toJsonLd = vi.fn().mockResolvedValue({
                type: 'Announce',
                object: {
                    id: 'https://example.com/posts/1',
                    type: 'Note',
                    content: 'Original post content',
                    attributedTo: 'https://example.com/users/author',
                },
                actor: {
                    id: 'https://example.com/users/reposter',
                    preferredUsername: 'reposter',
                    name: 'Reposter User',
                },
            });

            mockPage.getItems.mockImplementation(async function* () {
                yield testActivity;
            });
            mockOutbox.getFirst.mockResolvedValue(mockPage);

            // Mock getByApId to return null (post not in our DB)
            mockDb.mockReturnValue({
                select: vi.fn().mockReturnThis(),
                whereRaw: vi.fn().mockReturnThis(),
                first: vi.fn().mockResolvedValue(null),
            });

            // Mock getAccountByApId for the original author
            mockDb.mockImplementation((table: string) => {
                if (table === 'accounts') {
                    return {
                        select: vi.fn().mockReturnThis(),
                        whereRaw: vi.fn().mockReturnThis(),
                        first: vi.fn().mockResolvedValue({
                            id: 2,
                            username: 'author',
                            ap_id: 'https://example.com/users/author',
                            url: 'https://example.com/users/author',
                        }),
                    };
                }
                if (table === 'follows') {
                    return {
                        where: vi.fn().mockReturnThis(),
                        first: vi.fn().mockResolvedValue(null), // User does not follow the author
                    };
                }
                return {
                    select: vi.fn().mockReturnThis(),
                    whereRaw: vi.fn().mockReturnThis(),
                    first: vi.fn().mockResolvedValue(null),
                };
            });

            // Mock lookupObject for attributedTo
            const mockAuthor = {
                id: new URL('https://example.com/users/author'),
                toJsonLd: vi.fn().mockResolvedValue({
                    id: 'https://example.com/users/author',
                    preferredUsername: 'author',
                    name: 'Original Author',
                }),
            };
            lookupObject.mockImplementation(async (url: URL) => {
                if (url.toString().includes('author')) {
                    return mockAuthor;
                }
                return mockActor;
            });
            isActor.mockReturnValue(true);

            // Act
            const result = await view.getPostsByRemoteLookUp(
                currentContextAccountId,
                currentContextAccountApId,
                profileApId,
                null,
                profileAccount as Account | null,
            );

            // Assert
            expect(result[0]).toBeNull(); // No error
            expect(result[1]).toBeDefined(); // Has value
            expect(result[1]?.results).toHaveLength(1);
            expect(result[1]?.results[0]).toMatchObject({
                author: expect.objectContaining({
                    followedByMe: false, // User does not follow the original author
                }),
                repostedBy: expect.objectContaining({
                    followedByMe: true, // User follows the reposter
                }),
            });
        });

        it('should set followedByMe to false when author account is not found in database', async () => {
            // Arrange
            const currentContextAccountId = 1;
            const currentContextAccountApId = new URL(
                'https://example.com/users/current',
            );
            const profileApId = new URL('https://example.com/users/reposter');
            const profileAccount = { id: 3 } as Partial<Account>; // The reposter account

            // Mock that current user does not follow anyone (no account to check)
            mockDb.mockReturnValueOnce({
                where: vi.fn().mockReturnThis(),
                first: vi.fn().mockResolvedValue(null),
            });

            // Create test Announce activity
            const testObject = {
                id: new URL('https://example.com/posts/1'),
                getAttribution: vi.fn().mockResolvedValue({
                    id: new URL('https://example.com/users/author'),
                }),
            };

            // Create an instance of the mocked Activity class
            const fedifyModule = await vi.importMock('@fedify/vocab');
            const ActivityClass = (
                fedifyModule as { Activity: new () => unknown }
            ).Activity;
            const testActivity = Object.create(ActivityClass.prototype);
            testActivity.getObject = vi.fn().mockResolvedValue(testObject);
            testActivity.toJsonLd = vi.fn().mockResolvedValue({
                type: 'Announce',
                object: {
                    id: 'https://example.com/posts/1',
                    type: 'Note',
                    content: 'Original post content',
                    attributedTo: 'https://example.com/users/author',
                },
                actor: {
                    id: 'https://example.com/users/reposter',
                    preferredUsername: 'reposter',
                    name: 'Reposter User',
                },
            });

            mockPage.getItems.mockImplementation(async function* () {
                yield testActivity;
            });
            mockOutbox.getFirst.mockResolvedValue(mockPage);

            // Mock all database calls to return null
            mockDb.mockReturnValue({
                select: vi.fn().mockReturnThis(),
                whereRaw: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                first: vi.fn().mockResolvedValue(null),
            });

            // Mock lookupObject for attributedTo
            const mockAuthor = {
                id: new URL('https://example.com/users/author'),
                toJsonLd: vi.fn().mockResolvedValue({
                    id: 'https://example.com/users/author',
                    preferredUsername: 'author',
                    name: 'Original Author',
                }),
            };
            lookupObject.mockImplementation(async (url: URL) => {
                if (url.toString().includes('author')) {
                    return mockAuthor;
                }
                return mockActor;
            });
            isActor.mockReturnValue(true);

            // Act
            const result = await view.getPostsByRemoteLookUp(
                currentContextAccountId,
                currentContextAccountApId,
                profileApId,
                null,
                profileAccount as Account | null,
            );

            // Assert
            expect(result[0]).toBeNull(); // No error
            expect(result[1]).toBeDefined(); // Has value
            expect(result[1]?.results).toHaveLength(1);
            expect(result[1]?.results[0]).toMatchObject({
                author: expect.objectContaining({
                    followedByMe: false, // Author not found, defaults to false
                }),
                repostedBy: expect.objectContaining({
                    followedByMe: false, // Current user does not follow when no account param
                }),
            });
        });

        it('should sanitize HTML content and update mentions for Note posts', async () => {
            // Arrange
            const currentContextAccountId = 1;
            const currentContextAccountApId = new URL(
                'https://example.com/users/current',
            );
            const profileApId = new URL('https://example.com/users/profile');
            const profileAccount = { id: 2 } as Partial<Account>; // Profile account for this test

            // Mock that current user does not follow the profile account
            mockDb.mockReturnValueOnce({
                where: vi.fn().mockReturnThis(),
                first: vi.fn().mockResolvedValue(null),
            });

            // Create test activity with mentions
            const testObject = {
                id: new URL('https://example.com/posts/1'),
                getAttribution: vi.fn().mockResolvedValue(mockActor),
            };

            // Create an instance of the mocked Activity class
            const fedifyModule = await vi.importMock('@fedify/vocab');
            const ActivityClass = (
                fedifyModule as { Activity: new () => unknown }
            ).Activity;
            const testActivity = Object.create(ActivityClass.prototype);
            testActivity.getObject = vi.fn().mockResolvedValue(testObject);
            testActivity.toJsonLd = vi.fn().mockResolvedValue({
                type: 'Create',
                object: {
                    id: 'https://example.com/posts/1',
                    type: 'Note',
                    content: '<p>Hello @user</p>',
                    attributedTo: 'https://example.com/users/profile',
                    tag: [
                        {
                            type: 'Mention',
                            name: '@user@example.com',
                            href: 'https://example.com/users/mentioned',
                        },
                    ],
                },
                actor: {
                    id: 'https://example.com/users/profile',
                    preferredUsername: 'profile',
                    name: 'Profile User',
                },
            });

            mockPage.getItems.mockImplementation(async function* () {
                yield testActivity;
            });
            mockOutbox.getFirst.mockResolvedValue(mockPage);

            // Mock database calls
            mockDb.mockImplementation((table: string) => {
                if (table === 'accounts') {
                    return {
                        select: vi.fn().mockReturnThis(),
                        whereRaw: vi.fn().mockReturnThis(),
                        first: vi.fn().mockResolvedValue({
                            id: 4,
                            username: 'mentioned',
                            ap_id: 'https://example.com/users/mentioned',
                            url: 'https://example.com/users/mentioned',
                        }),
                    };
                }
                return {
                    select: vi.fn().mockReturnThis(),
                    whereRaw: vi.fn().mockReturnThis(),
                    first: vi.fn().mockResolvedValue(null),
                };
            });

            // Act
            const result = await view.getPostsByRemoteLookUp(
                currentContextAccountId,
                currentContextAccountApId,
                profileApId,
                null,
                profileAccount as Account | null,
            );

            // Assert
            expect(result[0]).toBeNull(); // No error
            expect(result[1]).toBeDefined(); // Has value
            expect(result[1]?.results).toHaveLength(1);
            expect(result[1]?.results[0]).toMatchObject({
                content: '<p>Hello @user</p> [sanitized] [mentions updated]',
            });

            expect(sanitizeHtml).toHaveBeenCalledWith('<p>Hello @user</p>');
            expect(ContentPreparer.updateMentions).toHaveBeenCalledWith(
                '<p>Hello @user</p> [sanitized]',
                expect.arrayContaining([
                    expect.objectContaining({
                        name: '@user@example.com',
                        href: new URL('https://example.com/users/mentioned'),
                        account: expect.objectContaining({
                            id: 4,
                            username: 'mentioned',
                        }),
                    }),
                ]),
            );
        });
    });
});
