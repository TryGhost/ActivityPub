import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EventEmitter } from 'node:events';

import { AccountBlockedEvent } from 'account/account-blocked.event';
import { AccountUnfollowedEvent } from 'account/account-unfollowed.event';
import { AccountEntity } from 'account/account.entity';
import { DomainBlockedEvent } from 'account/domain-blocked.event';
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

    let account: AccountEntity;

    beforeEach(() => {
        vi.useFakeTimers();

        events = new EventEmitter();
        feedService = {
            addPostToFeeds: vi.fn(),
            removePostFromFeeds: vi.fn(),
            removeBlockedAccountPostsFromFeed: vi.fn(),
            removeBlockedDomainPostsFromFeed: vi.fn(),
            removeUnfollowedAccountPostsFromFeed: vi.fn(),
        } as unknown as FeedService;

        const draft = AccountEntity.draft({
            isInternal: true,
            host: new URL('https://example.com'),
            username: 'foobar',
            name: 'Foo Bar',
            bio: 'Just a foo bar',
            avatarUrl: new URL('https://example.com/avatars/foobar.png'),
            bannerImageUrl: new URL('https://example.com/banners/foobar.png'),
            url: new URL('https://example.com/users/456'),
        });

        account = AccountEntity.create({
            id: 456,
            ...draft,
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
            const draft = AccountEntity.draft({
                isInternal: true,
                host: new URL('https://example.com'),
                username: 'bazqux',
                name: 'Baz Qux',
                bio: 'Just a baz qux',
                avatarUrl: new URL('https://blocked.com/avatars/bazqux.png'),
                bannerImageUrl: new URL(
                    'https://blocked.com/banners/bazqux.png',
                ),
                url: new URL('https://blocked.com/users/789'),
            });

            const blockedAccount = AccountEntity.create({
                id: 789,
                ...draft,
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
