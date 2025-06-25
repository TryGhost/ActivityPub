import type { FedifyContextFactory } from 'activitypub/fedify-context.factory';
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
                    followedByMe: false,
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
    });
});
