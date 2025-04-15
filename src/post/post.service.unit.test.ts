import { describe, expect, it, vi } from 'vitest';

import type { Knex } from 'knex';

import type { AccountService } from 'account/account.service';
import type { FedifyContextFactory } from 'activitypub/fedify-context.factory';
import { PostType } from './post.entity';
import type { KnexPostRepository } from './post.repository.knex';
import { PostService } from './post.service';

describe('PostService', () => {
    it('should be able to check if a post is liked by an account', async () => {
        const postId = 123;
        const accountId = 456;

        const postRepository = {
            isLikedByAccount: vi
                .fn()
                .mockImplementation((_postId, _accountId) => {
                    return _postId === postId && _accountId === accountId;
                }),
        };

        const postService = new PostService(
            postRepository as unknown as KnexPostRepository,
            {} as AccountService,
            {} as Knex,
            {} as FedifyContextFactory,
        );

        const result = await postService.isLikedByAccount(postId, accountId);

        expect(result).toBe(true);
    });

    it('should be able to check if a post is reposted by an account', async () => {
        const postId = 123;
        const accountId = 456;

        const postRepository = {
            isRepostedByAccount: vi
                .fn()
                .mockImplementation((_postId, _accountId) => {
                    return _postId === postId && _accountId === accountId;
                }),
        };

        const postService = new PostService(
            postRepository as unknown as KnexPostRepository,
            {} as AccountService,
            {} as Knex,
            {} as FedifyContextFactory,
        );

        const result = await postService.isRepostedByAccount(postId, accountId);

        expect(result).toBe(true);
    });

    describe('mapActivityToPostDTO', () => {
        const postService = new PostService(
            {} as KnexPostRepository,
            {} as AccountService,
            {} as Knex,
            {} as FedifyContextFactory,
        );

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

            // TODO: Clean up the any type
            // biome-ignore lint/suspicious/noExplicitAny: Legacy code needs proper typing
            const result = (postService as any).mapActivityToPostDTO(activity);

            expect(result).toEqual({
                id: 'https://example.com/posts/123',
                type: PostType.Note,
                title: 'Test Post',
                excerpt: '',
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

            // TODO: Clean up the any type
            // biome-ignore lint/suspicious/noExplicitAny: Legacy code needs proper typing
            const result = (postService as any).mapActivityToPostDTO(activity);

            expect(result).toEqual({
                id: 'https://example.com/posts/123',
                type: PostType.Note,
                title: 'Original Post',
                excerpt: '',
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
