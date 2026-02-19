import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EventEmitter } from 'node:events';

import type { AccountEntity } from '@/account/account.entity';
import {
    AccountBlockedEvent,
    AccountUnfollowedEvent,
    DomainBlockedEvent,
} from '@/account/events';
import type { FeedService } from '@/feed/feed.service';
import { FeedUpdateService } from '@/feed/feed-update.service';
import { Audience, Post, PostType } from '@/post/post.entity';
import type { KnexPostRepository } from '@/post/post.repository.knex';
import { PostCreatedEvent } from '@/post/post-created.event';
import { PostDeletedEvent } from '@/post/post-deleted.event';
import { PostDerepostedEvent } from '@/post/post-dereposted.event';
import { PostRepostedEvent } from '@/post/post-reposted.event';
import { createTestInternalAccount } from '@/test/account-entity-test-helpers';

describe('FeedUpdateService', () => {
    let events: EventEmitter;
    let feedService: FeedService;
    let postRepository: KnexPostRepository;
    let feedUpdateService: FeedUpdateService;

    let account: AccountEntity;

    beforeEach(async () => {
        vi.useFakeTimers();

        events = new EventEmitter();
        feedService = {
            addPostToFeeds: vi.fn(),
            addPostToDiscoveryFeeds: vi.fn(),
            removePostFromFeeds: vi.fn(),
            removePostFromDiscoveryFeeds: vi.fn(),
            removeBlockedAccountPostsFromFeed: vi.fn(),
            removeBlockedDomainPostsFromFeed: vi.fn(),
            removeUnfollowedAccountPostsFromFeed: vi.fn(),
        } as unknown as FeedService;

        postRepository = {
            getById: vi.fn(),
        } as unknown as KnexPostRepository;

        account = await createTestInternalAccount(456, {
            host: new URL('https://example.com'),
            username: 'foobar',
            name: 'Foo Bar',
            bio: 'Just a foo bar',
            avatarUrl: new URL('https://example.com/avatars/foobar.png'),
            bannerImageUrl: new URL('https://example.com/banners/foobar.png'),
            url: new URL('https://example.com/users/456'),
            customFields: null,
        });

        feedUpdateService = new FeedUpdateService(
            events,
            feedService,
            postRepository,
        );
        feedUpdateService.init();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('handling a newly created post', () => {
        it('should add public post to user and discovery feeds when created', async () => {
            const post = Post.createFromData(account, {
                type: PostType.Article,
                audience: Audience.Public,
            });
            // biome-ignore lint/suspicious/noExplicitAny: Test helper to set post id
            (post as any).id = 123;

            vi.mocked(postRepository.getById).mockResolvedValue(post);

            events.emit(
                PostCreatedEvent.getName(),
                new PostCreatedEvent(post.id as number),
            );

            await vi.runAllTimersAsync();

            expect(postRepository.getById).toHaveBeenCalledWith(post.id);
            expect(feedService.addPostToFeeds).toHaveBeenCalledWith(post);
            expect(feedService.addPostToDiscoveryFeeds).toHaveBeenCalledWith(
                post,
            );
        });

        it('should add followers-only post to user and discovery feeds when created', async () => {
            const post = Post.createFromData(account, {
                type: PostType.Article,
                audience: Audience.FollowersOnly,
            });
            // biome-ignore lint/suspicious/noExplicitAny: Test helper to set post id
            (post as any).id = 123;

            vi.mocked(postRepository.getById).mockResolvedValue(post);

            events.emit(
                PostCreatedEvent.getName(),
                new PostCreatedEvent(post.id as number),
            );

            await vi.runAllTimersAsync();

            expect(postRepository.getById).toHaveBeenCalledWith(post.id);
            expect(feedService.addPostToFeeds).toHaveBeenCalledWith(post);
            expect(feedService.addPostToDiscoveryFeeds).toHaveBeenCalledWith(
                post,
            );
        });

        it('should not add direct post to user nor discovery feeds when created', async () => {
            const post = Post.createFromData(account, {
                type: PostType.Article,
                audience: Audience.Direct,
            });
            // biome-ignore lint/suspicious/noExplicitAny: Test helper to set post id
            (post as any).id = 123;

            vi.mocked(postRepository.getById).mockResolvedValue(post);

            events.emit(
                PostCreatedEvent.getName(),
                new PostCreatedEvent(post.id as number),
            );

            await vi.runAllTimersAsync();

            expect(postRepository.getById).toHaveBeenCalledWith(post.id);
            expect(feedService.addPostToFeeds).not.toHaveBeenCalled();
            expect(feedService.addPostToDiscoveryFeeds).not.toHaveBeenCalled();
        });

        it('should not add post to feeds if post was deleted', async () => {
            vi.mocked(postRepository.getById).mockResolvedValue(null);

            events.emit(PostCreatedEvent.getName(), new PostCreatedEvent(123));

            await vi.runAllTimersAsync();

            expect(postRepository.getById).toHaveBeenCalledWith(123);
            expect(feedService.addPostToFeeds).not.toHaveBeenCalled();
            expect(feedService.addPostToDiscoveryFeeds).not.toHaveBeenCalled();
        });
    });

    describe('handling a reposted post', () => {
        const repostedById = 789;
        const postId = 123;

        it('should add public reposted post to user feeds', async () => {
            const post = Post.createFromData(account, {
                type: PostType.Article,
                audience: Audience.Public,
            });
            // biome-ignore lint/suspicious/noExplicitAny: Test helper to set post id
            (post as any).id = postId;

            vi.mocked(postRepository.getById).mockResolvedValue(post);

            events.emit(
                PostRepostedEvent.getName(),
                new PostRepostedEvent(postId, repostedById),
            );

            await vi.runAllTimersAsync();

            expect(postRepository.getById).toHaveBeenCalledWith(postId);
            expect(feedService.addPostToFeeds).toHaveBeenCalledWith(
                post,
                repostedById,
            );
        });

        it('should add followers-only reposted post to user feeds', async () => {
            const post = Post.createFromData(account, {
                type: PostType.Article,
                audience: Audience.FollowersOnly,
            });
            // biome-ignore lint/suspicious/noExplicitAny: Test helper to set post id
            (post as any).id = postId;

            vi.mocked(postRepository.getById).mockResolvedValue(post);

            events.emit(
                PostRepostedEvent.getName(),
                new PostRepostedEvent(postId, repostedById),
            );

            await vi.runAllTimersAsync();

            expect(postRepository.getById).toHaveBeenCalledWith(postId);
            expect(feedService.addPostToFeeds).toHaveBeenCalledWith(
                post,
                repostedById,
            );
        });

        it('should NOT add direct reposted post to user feeds', async () => {
            const post = Post.createFromData(account, {
                type: PostType.Article,
                audience: Audience.Direct,
            });
            // biome-ignore lint/suspicious/noExplicitAny: Test helper to set post id
            (post as any).id = postId;

            vi.mocked(postRepository.getById).mockResolvedValue(post);

            events.emit(
                PostRepostedEvent.getName(),
                new PostRepostedEvent(postId, repostedById),
            );

            await vi.runAllTimersAsync();

            expect(postRepository.getById).toHaveBeenCalledWith(postId);
            expect(feedService.addPostToFeeds).not.toHaveBeenCalled();
        });

        it('should NOT add reposted posts to discovery feeds', async () => {
            const post = Post.createFromData(account, {
                type: PostType.Article,
                audience: Audience.Public,
            });
            // biome-ignore lint/suspicious/noExplicitAny: Test helper to set post id
            (post as any).id = postId;

            vi.mocked(postRepository.getById).mockResolvedValue(post);

            events.emit(
                PostRepostedEvent.getName(),
                new PostRepostedEvent(postId, repostedById),
            );

            await vi.runAllTimersAsync();

            expect(feedService.addPostToDiscoveryFeeds).not.toHaveBeenCalled();
        });

        it('should not add post to feeds if post was deleted', async () => {
            vi.mocked(postRepository.getById).mockResolvedValue(null);

            events.emit(
                PostRepostedEvent.getName(),
                new PostRepostedEvent(postId, repostedById),
            );

            await vi.runAllTimersAsync();

            expect(postRepository.getById).toHaveBeenCalledWith(postId);
            expect(feedService.addPostToFeeds).not.toHaveBeenCalled();
        });
    });

    describe('handling a deleted post', () => {
        const deletedById = 789;

        it('should remove post from feeds when deleted', async () => {
            const post = Post.createFromData(account, {
                type: PostType.Article,
                audience: Audience.Public,
            });

            // Simulate a saved post with an id
            // biome-ignore lint/suspicious/noExplicitAny: Test helper to set post id
            (post as any).id = 123;

            events.emit(
                PostDeletedEvent.getName(),
                new PostDeletedEvent(post, deletedById),
            );

            await vi.runAllTimersAsync();

            expect(feedService.removePostFromFeeds).toHaveBeenCalledWith(123);
            expect(
                feedService.removePostFromDiscoveryFeeds,
            ).toHaveBeenCalledWith(post);
        });
    });

    describe('handling a dereposted post', () => {
        const derepostedById = 789;

        it('should remove reposted post from feeds when dereposted', () => {
            const postId = 123;

            events.emit(
                PostDerepostedEvent.getName(),
                new PostDerepostedEvent(postId, derepostedById),
            );

            expect(feedService.removePostFromFeeds).toHaveBeenCalledWith(
                postId,
                derepostedById,
            );
        });
    });

    describe('handling a blocked account', () => {
        it('should remove blocked account posts from feeds', async () => {
            const blockedAccount = await createTestInternalAccount(789, {
                host: new URL('https://example.com'),
                username: 'bazqux',
                name: 'Baz Qux',
                bio: 'Just a baz qux',
                avatarUrl: new URL('https://blocked.com/avatars/bazqux.png'),
                bannerImageUrl: new URL(
                    'https://blocked.com/banners/bazqux.png',
                ),
                url: new URL('https://blocked.com/users/789'),
                customFields: null,
            });

            events.emit(
                AccountBlockedEvent.getName(),
                new AccountBlockedEvent(blockedAccount.id, account.id),
            );

            expect(
                feedService.removeBlockedAccountPostsFromFeed,
            ).toHaveBeenCalledWith(account.id, blockedAccount.id);
        });
    });

    describe('handling a blocked domain', () => {
        it('should remove blocked domain posts from feeds', () => {
            const blockedDomain = new URL('https://blocked.com');
            const blockerAccount = { id: 456 } as AccountEntity;

            events.emit(
                DomainBlockedEvent.getName(),
                new DomainBlockedEvent(blockedDomain, blockerAccount.id),
            );

            expect(
                feedService.removeBlockedDomainPostsFromFeed,
            ).toHaveBeenCalledWith(blockerAccount.id, blockedDomain);
        });
    });

    describe('handling an unfollowed account', () => {
        it("should remove an unfollowed account's posts from the feed of the unfollower", () => {
            const unfollower = { id: 456 } as AccountEntity;
            const account = { id: 789 } as AccountEntity;

            events.emit(
                AccountUnfollowedEvent.getName(),
                new AccountUnfollowedEvent(account.id, unfollower.id),
            );

            expect(
                feedService.removeUnfollowedAccountPostsFromFeed,
            ).toHaveBeenCalledWith(unfollower.id, account.id);
        });
    });
});
