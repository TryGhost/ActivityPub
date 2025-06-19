import { Activity, type Actor, isActor, lookupObject } from '@fedify/fedify';
import type { FedifyContextFactory } from 'activitypub/fedify-context.factory';
import { getError, getValue, isError, ok } from 'core/result';
import type { Knex } from 'knex';
import { PostType } from 'post/post.entity';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountPostsView } from './account.posts.view';

// Mock the fedify modules
vi.mock('@fedify/fedify', () => ({
    isActor: vi.fn(),
    lookupObject: vi.fn(),
    Activity: class MockActivity {},
}));

describe('Account Posts View', () => {
    let view: AccountPostsView;
    let db: Knex;
    let fedifyContextFactory: FedifyContextFactory;

    beforeEach(() => {
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

    describe('getPostsByRemoteLookUp', () => {
        const mockDocumentLoader = {};
        const mockContext = {
            getDocumentLoader: vi.fn().mockResolvedValue(mockDocumentLoader),
        } as unknown as ReturnType<
            typeof fedifyContextFactory.getFedifyContext
        >;
        let mockGetByApId: ReturnType<typeof vi.fn>;
        let mockGetMentionedAccount: ReturnType<typeof vi.fn>;

        beforeEach(() => {
            mockGetByApId = vi.fn().mockResolvedValue(null);
            mockGetMentionedAccount = vi.fn().mockResolvedValue(
                ok({
                    name: 'testuser',
                    href: new URL('https://example.com/users/1'),
                    account: {},
                }),
            );

            Object.assign(view, {
                getByApId: mockGetByApId,
                getMentionedAccount: mockGetMentionedAccount,
            });
        });

        it('should process mentions when tag is an object', async () => {
            const mockActivity = {
                getObject: vi.fn().mockResolvedValue({
                    id: 'https://example.com/posts/123',
                    type: 'Note',
                    name: 'Test Post',
                    content: 'Test content @testuser@example.com',
                    url: 'https://example.com/posts/123',
                    published: '2024-01-01T00:00:00Z',
                    attributedTo: {
                        id: 'https://example.com/users/1',
                        preferredUsername: 'testuser',
                        name: 'Test User',
                    },
                }),
                toJsonLd: vi.fn().mockResolvedValue({
                    type: 'Create',
                    object: {
                        id: 'https://example.com/posts/123',
                        type: 'Note',
                        name: 'Test Post',
                        content: 'Test content @testuser@example.com',
                        url: 'https://example.com/posts/123',
                        published: '2024-01-01T00:00:00Z',
                        tag: {
                            type: 'Mention',
                            name: '@testuser@example.com',
                            href: 'https://example.com/users/1',
                        },
                        attributedTo: {
                            id: 'https://example.com/users/1',
                            preferredUsername: 'testuser',
                            name: 'Test User',
                        },
                    },
                    actor: {
                        id: 'https://example.com/users/1',
                        preferredUsername: 'testuser',
                        name: 'Test User',
                    },
                }),
            };

            const mockActivityInstance = Object.create(
                vi.mocked(Activity).prototype,
            );
            Object.assign(mockActivityInstance, mockActivity);

            const mockPage = {
                getItems: vi.fn().mockReturnValue([mockActivityInstance]),
                nextId: null,
            };
            const mockOutbox = {
                getFirst: vi.fn().mockResolvedValue(mockPage),
            };

            const mockActor = {
                id: new URL('https://remote.com/users/2'),
                getOutbox: vi.fn().mockResolvedValue(mockOutbox),
            } as unknown as Actor;

            vi.mocked(fedifyContextFactory.getFedifyContext).mockReturnValue(
                mockContext,
            );
            vi.mocked(lookupObject).mockResolvedValue(mockActor);
            vi.mocked(isActor).mockReturnValue(true);

            const result = await view.getPostsByRemoteLookUp(
                1,
                new URL('https://example.com/users/1'),
                new URL('https://remote.com/users/2'),
                null,
            );

            if (isError(result)) {
                throw new Error(getError(result));
            }
            const posts = getValue(result);
            expect(posts.results).toHaveLength(1);
            expect(mockGetMentionedAccount).toHaveBeenCalledWith(
                new URL('https://example.com/users/1'),
                '@testuser@example.com',
            );
        });

        it('should process mentions when tag is an array', async () => {
            const mockActivity = {
                getObject: vi.fn().mockResolvedValue({
                    id: 'https://example.com/posts/123',
                    type: 'Note',
                    name: 'Test Post',
                    content:
                        'Test content @testuser@example.com @anotheruser@example.com',
                    url: 'https://example.com/posts/123',
                    published: '2024-01-01T00:00:00Z',
                    attributedTo: {
                        id: 'https://example.com/users/1',
                        preferredUsername: 'testuser',
                        name: 'Test User',
                    },
                }),
                toJsonLd: vi.fn().mockResolvedValue({
                    type: 'Create',
                    object: {
                        id: 'https://example.com/posts/123',
                        type: 'Note',
                        name: 'Test Post',
                        content:
                            'Test content @testuser@example.com @anotheruser@example.com',
                        url: 'https://example.com/posts/123',
                        published: '2024-01-01T00:00:00Z',
                        tag: [
                            {
                                type: 'Mention',
                                name: '@testuser@example.com',
                                href: 'https://example.com/users/1',
                            },
                            {
                                type: 'Mention',
                                name: '@anotheruser@example.com',
                                href: 'https://example.com/users/2',
                            },
                        ],
                        attributedTo: {
                            id: 'https://example.com/users/1',
                            preferredUsername: 'testuser',
                            name: 'Test User',
                        },
                    },
                    actor: {
                        id: 'https://example.com/users/1',
                        preferredUsername: 'testuser',
                        name: 'Test User',
                    },
                }),
            };

            const mockActivityInstance = Object.create(
                vi.mocked(Activity).prototype,
            );
            Object.assign(mockActivityInstance, mockActivity);

            const mockPage = {
                getItems: vi.fn().mockReturnValue([mockActivityInstance]),
                nextId: null,
            };
            const mockOutbox = {
                getFirst: vi.fn().mockResolvedValue(mockPage),
            };
            const mockActor = {
                id: new URL('https://remote.com/users/2'),
                getOutbox: vi.fn().mockResolvedValue(mockOutbox),
            } as unknown as Actor;

            vi.mocked(fedifyContextFactory.getFedifyContext).mockReturnValue(
                mockContext,
            );
            vi.mocked(lookupObject).mockResolvedValue(mockActor);
            vi.mocked(isActor).mockReturnValue(true);

            const result = await view.getPostsByRemoteLookUp(
                1,
                new URL('https://example.com/users/1'),
                new URL('https://remote.com/users/2'),
                null,
            );

            if (isError(result)) {
                throw new Error(getError(result));
            }
            const posts = getValue(result);
            expect(posts.results).toHaveLength(1);
            expect(mockGetMentionedAccount).toHaveBeenCalledTimes(2);
            expect(mockGetMentionedAccount).toHaveBeenCalledWith(
                new URL('https://example.com/users/1'),
                '@testuser@example.com',
            );
            expect(mockGetMentionedAccount).toHaveBeenCalledWith(
                new URL('https://example.com/users/2'),
                '@anotheruser@example.com',
            );
        });
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

            expect(result).toEqual({
                id: 'https://example.com/posts/123',
                type: PostType.Note,
                title: 'Test Post',
                excerpt: '',
                summary: null,
                content: 'Test Content',
                url: 'https://example.com/posts/123',
                featureImageUrl: 'https://example.com/image.jpg',
                publishedAt: new Date('2024-03-20T12:00:00Z'),
                likeCount: 0,
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
                },
                authoredByMe: true,
                repostCount: 0,
                repostedByMe: false,
                repostedBy: null,
            });
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
                },
            });
        });
    });
});
