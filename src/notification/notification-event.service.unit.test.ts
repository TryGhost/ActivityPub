import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EventEmitter } from 'node:events';

import type { Account as AccountEntity } from '@/account/account.entity';
import {
    AccountBlockedEvent,
    AccountFollowedEvent,
    DomainBlockedEvent,
    NotificationsReadEvent,
} from '@/account/events';
import type { NotificationService } from '@/notification/notification.service';
import { NotificationEventService } from '@/notification/notification-event.service';
import type { Post } from '@/post/post.entity';
import type { KnexPostRepository } from '@/post/post.repository.knex';
import { PostCreatedEvent } from '@/post/post-created.event';
import { PostDeletedEvent } from '@/post/post-deleted.event';
import { PostLikedEvent } from '@/post/post-liked.event';
import { PostRepostedEvent } from '@/post/post-reposted.event';

describe('NotificationEventService', () => {
    let events: EventEmitter;
    let notificationService: NotificationService;
    let postRepository: KnexPostRepository;
    let notificationEventService: NotificationEventService;

    beforeEach(() => {
        events = new EventEmitter();
        notificationService = {
            createFollowNotification: vi.fn(),
            createLikeNotification: vi.fn(),
            createRepostNotification: vi.fn(),
            createReplyNotification: vi.fn(),
            removeBlockedAccountNotifications: vi.fn(),
            removeBlockedDomainNotifications: vi.fn(),
            createMentionNotification: vi.fn(),
            removePostNotifications: vi.fn(),
            readAllNotifications: vi.fn(),
        } as unknown as NotificationService;

        postRepository = {
            getById: vi.fn(),
        } as unknown as KnexPostRepository;

        notificationEventService = new NotificationEventService(
            events,
            notificationService,
            postRepository,
        );
        notificationEventService.init();
    });

    describe('handling an account follow', () => {
        it('should create a follow notification', () => {
            const account = { id: 123 };
            const followerAccount = { id: 456 };

            events.emit(
                AccountFollowedEvent.getName(),
                new AccountFollowedEvent(account.id, followerAccount.id),
            );

            expect(
                notificationService.createFollowNotification,
            ).toHaveBeenCalledWith(account.id, followerAccount.id);
        });
    });

    describe('handling a post like', () => {
        it('should create a like notification', () => {
            const postId = 123;
            const postAuthorId = 456;
            const accountId = 789;

            events.emit(
                PostLikedEvent.getName(),
                new PostLikedEvent(postId, postAuthorId, accountId),
            );

            expect(
                notificationService.createLikeNotification,
            ).toHaveBeenCalledWith(postId, postAuthorId, accountId);
        });
    });

    describe('handling a post repost', () => {
        it('should create a repost notification', async () => {
            const postId = 123;
            const post = {
                id: postId,
                author: {
                    id: 456,
                },
            } as Post;
            const accountId = 789;

            vi.mocked(postRepository.getById).mockResolvedValue(post);

            events.emit(
                PostRepostedEvent.getName(),
                new PostRepostedEvent(postId, accountId),
            );

            await new Promise(process.nextTick);

            expect(postRepository.getById).toHaveBeenCalledWith(postId);
            expect(
                notificationService.createRepostNotification,
            ).toHaveBeenCalledWith(post, accountId);
        });

        it('should not create a repost notification if post was deleted', async () => {
            const postId = 123;
            const accountId = 789;

            vi.mocked(postRepository.getById).mockResolvedValue(null);

            events.emit(
                PostRepostedEvent.getName(),
                new PostRepostedEvent(postId, accountId),
            );

            await new Promise(process.nextTick);

            expect(postRepository.getById).toHaveBeenCalledWith(postId);
            expect(
                notificationService.createRepostNotification,
            ).not.toHaveBeenCalled();
        });
    });

    describe('handling a post reply', () => {
        it('should create a reply notification', async () => {
            const post = {
                id: 123,
                author: {
                    id: 456,
                },
                inReplyTo: 789,
                mentions: [],
            } as unknown as Post;

            vi.mocked(postRepository.getById).mockResolvedValue(post);

            events.emit(
                PostCreatedEvent.getName(),
                new PostCreatedEvent(post.id as number),
            );

            await new Promise(process.nextTick);

            expect(postRepository.getById).toHaveBeenCalledWith(post.id);
            expect(
                notificationService.createReplyNotification,
            ).toHaveBeenCalledWith(post);
        });

        it('should not create a reply notification if post was deleted', async () => {
            vi.mocked(postRepository.getById).mockResolvedValue(null);

            events.emit(PostCreatedEvent.getName(), new PostCreatedEvent(123));

            await new Promise(process.nextTick);

            expect(postRepository.getById).toHaveBeenCalledWith(123);
            expect(
                notificationService.createReplyNotification,
            ).not.toHaveBeenCalled();
        });
    });

    describe('handling a post deleted event', () => {
        it('should remove notifications for the deleted post', () => {
            const post = {
                id: 123,
                author: {
                    id: 456,
                },
            } as Post;
            const deletedById = 456;

            events.emit(
                PostDeletedEvent.getName(),
                new PostDeletedEvent(post as Post, deletedById),
            );

            expect(
                notificationService.removePostNotifications,
            ).toHaveBeenCalledWith(post);
        });
    });

    describe('handling an account blocked event', () => {
        it('should remove notifications from the blocked account', () => {
            const blockedAccount = { id: 123 } as AccountEntity;
            const blockerAccount = { id: 456 } as AccountEntity;

            events.emit(
                AccountBlockedEvent.getName(),
                new AccountBlockedEvent(blockedAccount.id, blockerAccount.id),
            );

            expect(
                notificationService.removeBlockedAccountNotifications,
            ).toHaveBeenCalledWith(blockerAccount.id, blockedAccount.id);
        });
    });

    describe('handling a domain blocked event', () => {
        it('should remove notifications from accounts from the blocked domain', () => {
            const blockedDomain = new URL('https://example.com');
            const blockerAccount = { id: 456 } as AccountEntity;

            events.emit(
                DomainBlockedEvent.getName(),
                new DomainBlockedEvent(blockedDomain, blockerAccount.id),
            );

            expect(
                notificationService.removeBlockedDomainNotifications,
            ).toHaveBeenCalledWith(blockerAccount.id, blockedDomain);
        });
    });

    describe('handling a mention created event', () => {
        it('should create a mention notification', async () => {
            const postWithMention = {
                id: 123,
                author: {
                    id: 456,
                },
                content: 'Hello @bob@coolsite.com',
                mentions: [
                    {
                        id: 788,
                        apId: new URL('https://example.com/@bob'),
                        username: 'bob',
                    },
                    {
                        id: 789,
                        apId: new URL('https://example.com/@alice'),
                        username: 'alice',
                    },
                ],
            } as unknown as Post;

            vi.mocked(postRepository.getById).mockResolvedValue(
                postWithMention,
            );

            events.emit(
                PostCreatedEvent.getName(),
                new PostCreatedEvent(postWithMention.id as number),
            );

            await new Promise(process.nextTick);

            expect(postRepository.getById).toHaveBeenCalledWith(
                postWithMention.id,
            );
            expect(
                notificationService.createMentionNotification,
            ).toHaveBeenCalledWith(
                postWithMention,
                postWithMention.mentions[0].id,
            );
            expect(
                notificationService.createMentionNotification,
            ).toHaveBeenCalledWith(
                postWithMention,
                postWithMention.mentions[1].id,
            );
        });
    });

    describe('handling a notifications read event', () => {
        it('should read all notifications', () => {
            const account = { id: 123 };

            events.emit(
                NotificationsReadEvent.getName(),
                new NotificationsReadEvent(account.id),
            );

            expect(
                notificationService.readAllNotifications,
            ).toHaveBeenCalledWith(account.id);
        });
    });
});
