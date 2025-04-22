import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EventEmitter } from 'node:events';

import { AccountBlockedEvent } from 'account/account-blocked.event';
import { Account } from 'account/account.entity';
import { FeedUpdateService } from 'feed/feed-update.service';
import type { FeedService } from 'feed/feed.service';
import { PostCreatedEvent } from 'post/post-created.event';
import { PostDeletedEvent } from 'post/post-deleted.event';
import { PostDerepostedEvent } from 'post/post-dereposted.event';
import { PostRepostedEvent } from 'post/post-reposted.event';
import { Audience, Post, PostType } from 'post/post.entity';

describe('FeedUpdateService', () => {
    let events: EventEmitter;
    let feedService: FeedService;
    let feedUpdateService: FeedUpdateService;

    let account: Account;

    beforeEach(() => {
        vi.useFakeTimers();

        events = new EventEmitter();
        feedService = {
            addPostToFeeds: vi.fn(),
            removePostFromFeeds: vi.fn(),
            removeBlockedAccountPostsFromFeed: vi.fn(),
        } as unknown as FeedService;

        const site = {
            id: 123,
            host: 'example.com',
            webhook_secret: 'secret',
        };
        account = Account.createFromData({
            id: 456,
            uuid: '9ea8fcd3-ec80-4b97-b95c-e3d227ccbd01',
            username: 'foobar',
            name: 'Foo Bar',
            bio: 'Just a foo bar',
            avatarUrl: new URL('https://example.com/avatars/foobar.png'),
            bannerImageUrl: new URL('https://example.com/banners/foobar.png'),
            site,
            apId: new URL('https://example.com/users/456'),
            url: new URL('https://example.com/users/456'),
            apFollowers: new URL('https://example.com/followers/456'),
        });

        feedUpdateService = new FeedUpdateService(events, feedService);
        feedUpdateService.init();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('handling a newly created post', () => {
        it('should add public post to feeds when created', () => {
            const post = Post.createFromData(account, {
                type: PostType.Article,
                audience: Audience.Public,
            });

            events.emit(PostCreatedEvent.getName(), new PostCreatedEvent(post));

            expect(feedService.addPostToFeeds).toHaveBeenCalledWith(post);
        });

        it('should add followers-only post to feeds when created', () => {
            const post = Post.createFromData(account, {
                type: PostType.Article,
                audience: Audience.FollowersOnly,
            });

            events.emit(PostCreatedEvent.getName(), new PostCreatedEvent(post));

            expect(feedService.addPostToFeeds).toHaveBeenCalledWith(post);
        });

        it('should not add direct post to feeds when created', () => {
            const post = Post.createFromData(account, {
                type: PostType.Article,
                audience: Audience.Direct,
            });

            events.emit(PostCreatedEvent.getName(), new PostCreatedEvent(post));

            expect(feedService.addPostToFeeds).not.toHaveBeenCalled();
        });
    });

    describe('handling a reposted post', () => {
        const repostedById = 789;

        it('should add public reposted post to feeds', () => {
            const post = Post.createFromData(account, {
                type: PostType.Article,
                audience: Audience.Public,
            });

            events.emit(
                PostRepostedEvent.getName(),
                new PostRepostedEvent(post, repostedById),
            );

            expect(feedService.addPostToFeeds).toHaveBeenCalledWith(
                post,
                repostedById,
            );
        });

        it('should add followers-only reposted post to feeds', () => {
            const post = Post.createFromData(account, {
                type: PostType.Article,
                audience: Audience.FollowersOnly,
            });

            events.emit(
                PostRepostedEvent.getName(),
                new PostRepostedEvent(post, repostedById),
            );

            expect(feedService.addPostToFeeds).toHaveBeenCalledWith(
                post,
                repostedById,
            );
        });

        it('should not add direct reposted post to feeds', () => {
            const post = Post.createFromData(account, {
                type: PostType.Article,
                audience: Audience.Direct,
            });

            events.emit(
                PostRepostedEvent.getName(),
                new PostRepostedEvent(post, repostedById),
            );

            expect(feedService.addPostToFeeds).not.toHaveBeenCalled();
        });
    });

    describe('handling a deleted post', () => {
        const deletedById = 789;

        it('should remove post from feeds when deleted', () => {
            const post = Post.createFromData(account, {
                type: PostType.Article,
                audience: Audience.Public,
            });

            events.emit(
                PostDeletedEvent.getName(),
                new PostDeletedEvent(post, deletedById),
            );

            expect(feedService.removePostFromFeeds).toHaveBeenCalledWith(post);
        });
    });

    describe('handling a dereposted post', () => {
        const derepostedById = 789;

        it('should remove reposted post from feeds when dereposted', () => {
            const post = Post.createFromData(account, {
                type: PostType.Article,
                audience: Audience.Public,
            });

            events.emit(
                PostDerepostedEvent.getName(),
                new PostDerepostedEvent(post, derepostedById),
            );

            expect(feedService.removePostFromFeeds).toHaveBeenCalledWith(
                post,
                derepostedById,
            );
        });
    });

    describe('handling a blocked account', () => {
        it('should remove blocked account posts from feeds', () => {
            const blockedAccount = Account.createFromData({
                id: 789,
                uuid: '0b3bf092-fff9-4621-9fad-47856e2f045e',
                username: 'bazqux',
                name: 'Baz Qux',
                bio: 'Just a baz qux',
                avatarUrl: new URL('https://blocked.com/avatars/bazqux.png'),
                bannerImageUrl: new URL(
                    'https://blocked.com/banners/bazqux.png',
                ),
                site: {
                    id: 987,
                    host: 'blocked.com',
                    webhook_secret: 'secret',
                },
                apId: new URL('https://blocked.com/users/123'),
                url: new URL('https://blocked.com/users/123'),
                apFollowers: new URL('https://blocked.com/followers/123'),
            });

            events.emit(
                AccountBlockedEvent.getName(),
                new AccountBlockedEvent(account, blockedAccount),
            );

            expect(
                feedService.removeBlockedAccountPostsFromFeed,
            ).toHaveBeenCalledWith(account, blockedAccount);
        });
    });
});
