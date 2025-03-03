import {
    type MockInstance,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import { EventEmitter } from 'node:events';

import { Account } from 'account/account.entity';
import { FeedUpdateService } from 'feed/feed-update.service';
import type { FeedService } from 'feed/feed.service';
import {
    FeedsUpdatedEvent,
    FeedsUpdatedEventUpdateOperation,
} from 'feed/feeds-updated.event';
import { PostCreatedEvent } from 'post/post-created.event';
import { PostDeletedEvent } from 'post/post-deleted.event';
import { PostRepostedEvent } from 'post/post-reposted.event';
import { Audience, Post, PostType } from 'post/post.entity';

describe('FeedUpdateService', () => {
    let events: EventEmitter;
    let eventsEmitSpy: MockInstance;
    let feedService: FeedService;
    let feedUpdateService: FeedUpdateService;

    let account: Account;
    let post: Post;

    beforeEach(() => {
        vi.useFakeTimers();

        events = new EventEmitter();
        eventsEmitSpy = vi.spyOn(events, 'emit');
        feedService = {} as FeedService;

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
        });
        post = Post.createFromData(account, {
            type: PostType.Article,
        });

        feedUpdateService = new FeedUpdateService(events, feedService);
        feedUpdateService.init();
    });

    describe('handling a newly created post', () => {
        it('should emit a FeedsUpdatedEvent', async () => {
            const expectedUpdatedFeedUserIds = [789, 987];

            feedService.addPostToFeeds = vi
                .fn()
                .mockImplementation(async (incomingPost) => {
                    if (incomingPost === post) {
                        return expectedUpdatedFeedUserIds;
                    }
                    return [];
                });

            events.emit(PostCreatedEvent.getName(), new PostCreatedEvent(post));

            await vi.advanceTimersByTimeAsync(1000 * 10);

            expect(eventsEmitSpy).toHaveBeenCalledTimes(2);

            const [eventName, event] = eventsEmitSpy.mock.calls[1];

            expect(eventName).toEqual(FeedsUpdatedEvent.getName());
            expect(event).instanceOf(FeedsUpdatedEvent);
            expect(event.getUserIds()).toEqual(expectedUpdatedFeedUserIds);
            expect(event.getUpdateOperation()).toEqual(
                FeedsUpdatedEventUpdateOperation.PostAdded,
            );
            expect(event.getPost()).toEqual(post);
        });

        it('should not emit a FeedsUpdatedEvent if no users feeds were updated', async () => {
            feedService.addPostToFeeds = vi
                .fn()
                .mockImplementation(async (incomingPost) => {
                    if (incomingPost === post) {
                        return [];
                    }
                    return [1123, 4456];
                });

            events.emit(PostCreatedEvent.getName(), new PostCreatedEvent(post));

            await vi.advanceTimersByTimeAsync(1000 * 10);

            expect(eventsEmitSpy).not.toHaveBeenCalledWith(
                FeedsUpdatedEvent.getName(),
            );
        });

        it('should not emit a FeedsUpdatedEvent if the post audience is not public or followers only', async () => {
            post = Post.createFromData(account, {
                type: PostType.Article,
                audience: Audience.Direct,
            });

            feedService.addPostToFeeds = vi
                .fn()
                .mockImplementation(async () => {
                    // Return a value so that we can be sure the reason for not
                    // emitting the event is because of the audience
                    return [1123, 4456];
                });

            events.emit(PostCreatedEvent.getName(), new PostCreatedEvent(post));

            await vi.advanceTimersByTimeAsync(1000 * 10);

            expect(eventsEmitSpy).not.toHaveBeenCalledWith(
                FeedsUpdatedEvent.getName(),
            );
        });
    });

    describe('handling a reposted post', () => {
        const repostedById = 789;

        it('should emit a FeedsUpdatedEvent', async () => {
            const expectedUpdatedFeedUserIds = [987, 654];

            feedService.addPostToFeeds = vi
                .fn()
                .mockImplementation(
                    async (incomingPost, incomingRepostedBy) => {
                        if (
                            incomingPost === post &&
                            incomingRepostedBy === repostedById
                        ) {
                            return expectedUpdatedFeedUserIds;
                        }
                        return [];
                    },
                );

            events.emit(
                PostRepostedEvent.getName(),
                new PostRepostedEvent(post, repostedById),
            );

            await vi.advanceTimersByTimeAsync(1000 * 10);

            expect(eventsEmitSpy).toHaveBeenCalledTimes(2);

            const [eventName, event] = eventsEmitSpy.mock.calls[1];

            expect(eventName).toEqual(FeedsUpdatedEvent.getName());
            expect(event).instanceOf(FeedsUpdatedEvent);
            expect(event.getUserIds()).toEqual(expectedUpdatedFeedUserIds);
            expect(event.getUpdateOperation()).toEqual(
                FeedsUpdatedEventUpdateOperation.PostAdded,
            );
            expect(event.getPost()).toEqual(post);
        });

        it('should not emit a FeedsUpdatedEvent if no users feeds were updated', async () => {
            feedService.addPostToFeeds = vi
                .fn()
                .mockImplementation(
                    async (incomingPost, incomingRepostedBy) => {
                        if (
                            incomingPost === post &&
                            incomingRepostedBy === repostedById
                        ) {
                            return [];
                        }
                        return [1123, 4456];
                    },
                );

            events.emit(
                PostRepostedEvent.getName(),
                new PostRepostedEvent(post, repostedById),
            );

            await vi.advanceTimersByTimeAsync(1000 * 10);

            expect(eventsEmitSpy).not.toHaveBeenCalledWith(
                FeedsUpdatedEvent.getName(),
            );
        });

        it('should not emit a FeedsUpdatedEvent if the post audience is not public or followers only', async () => {
            post = Post.createFromData(account, {
                type: PostType.Article,
                audience: Audience.Direct,
            });

            feedService.addPostToFeeds = vi
                .fn()
                .mockImplementation(async () => {
                    // Return a value so that we can be sure the reason for not
                    // emitting the event is because of the audience
                    return [1123, 4456];
                });

            events.emit(
                PostRepostedEvent.getName(),
                new PostRepostedEvent(post, repostedById),
            );

            await vi.advanceTimersByTimeAsync(1000 * 10);

            expect(eventsEmitSpy).not.toHaveBeenCalledWith(
                FeedsUpdatedEvent.getName(),
            );
        });
    });

    describe('handling a deleted post', () => {
        const deletedById = 789;

        it('should emit a FeedsUpdatedEvent', async () => {
            const expectedUpdatedFeedUserIds = [987, 654];

            feedService.removePostFromFeeds = vi
                .fn()
                .mockImplementation(async (incomingPost) => {
                    if (incomingPost === post) {
                        return expectedUpdatedFeedUserIds;
                    }
                    return [];
                });

            events.emit(
                PostDeletedEvent.getName(),
                new PostDeletedEvent(post, deletedById),
            );

            await vi.advanceTimersByTimeAsync(1000 * 10);

            expect(eventsEmitSpy).toHaveBeenCalledTimes(2);

            const [eventName, event] = eventsEmitSpy.mock.calls[1];

            expect(eventName).toEqual(FeedsUpdatedEvent.getName());
            expect(event).instanceOf(FeedsUpdatedEvent);
            expect(event.getUserIds()).toEqual(expectedUpdatedFeedUserIds);
            expect(event.getUpdateOperation()).toEqual(
                FeedsUpdatedEventUpdateOperation.PostRemoved,
            );
            expect(event.getPost()).toEqual(post);
        });

        it('should not emit a FeedsUpdatedEvent if no users feeds were updated', async () => {
            feedService.removePostFromFeeds = vi
                .fn()
                .mockImplementation(async (incomingPost) => {
                    if (incomingPost === post) {
                        return [];
                    }
                    return [1123, 4456];
                });

            events.emit(
                PostDeletedEvent.getName(),
                new PostDeletedEvent(post, deletedById),
            );

            await vi.advanceTimersByTimeAsync(1000 * 10);

            expect(eventsEmitSpy).not.toHaveBeenCalledWith(
                FeedsUpdatedEvent.getName(),
            );
        });
    });
});
