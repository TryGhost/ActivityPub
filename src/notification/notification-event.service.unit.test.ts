import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EventEmitter } from 'node:events';

import { AccountBlockedEvent } from 'account/account-blocked.event';
import { AccountFollowedEvent } from 'account/account-followed.event';
import type { Account as AccountEntity } from 'account/account.entity';
import type { Account } from 'account/types';
import { PostCreatedEvent } from 'post/post-created.event';
import { PostLikedEvent } from 'post/post-liked.event';
import { PostRepostedEvent } from 'post/post-reposted.event';
import type { Post } from 'post/post.entity';
import { NotificationEventService } from './notification-event.service';
import type { NotificationService } from './notification.service';

describe('NotificationEventService', () => {
    let events: EventEmitter;
    let notificationService: NotificationService;
    let notificationEventService: NotificationEventService;

    beforeEach(() => {
        events = new EventEmitter();
        notificationService = {
            createFollowNotification: vi.fn(),
            createLikeNotification: vi.fn(),
            createRepostNotification: vi.fn(),
            createReplyNotification: vi.fn(),
            removeBlockedAccountNotifications: vi.fn(),
        } as unknown as NotificationService;

        notificationEventService = new NotificationEventService(
            events,
            notificationService,
        );
        notificationEventService.init();
    });

    describe('handling an account follow', () => {
        it('should create a follow notification', () => {
            const account = { id: 123 };
            const followerAccount = { id: 456 };

            events.emit(
                AccountFollowedEvent.getName(),
                new AccountFollowedEvent(
                    account as Account,
                    followerAccount as Account,
                ),
            );

            expect(
                notificationService.createFollowNotification,
            ).toHaveBeenCalledWith(account, followerAccount);
        });
    });

    describe('handling a post like', () => {
        it('should create a like notification', () => {
            const post = {
                id: 123,
                author: {
                    id: 456,
                },
            } as Post;
            const accountId = 789;

            events.emit(
                PostLikedEvent.getName(),
                new PostLikedEvent(post as Post, accountId),
            );

            expect(
                notificationService.createLikeNotification,
            ).toHaveBeenCalledWith(post, accountId);
        });
    });

    describe('handling a post repost', () => {
        it('should create a repost notification', () => {
            const post = {
                id: 123,
                author: {
                    id: 456,
                },
            } as Post;
            const accountId = 789;

            events.emit(
                PostRepostedEvent.getName(),
                new PostRepostedEvent(post as Post, accountId),
            );

            expect(
                notificationService.createRepostNotification,
            ).toHaveBeenCalledWith(post, accountId);
        });
    });

    describe('handling a post reply', () => {
        it('should create a reply notification', () => {
            const post = {
                id: 123,
                author: {
                    id: 456,
                },
                inReplyTo: 789,
            } as Post;

            events.emit(
                PostCreatedEvent.getName(),
                new PostCreatedEvent(post as Post),
            );

            expect(
                notificationService.createReplyNotification,
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
});
