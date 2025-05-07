import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EventEmitter } from 'node:events';

import { AccountBlockedEvent } from 'account/account-blocked.event';
import { AccountFollowedEvent } from 'account/account-followed.event';
import { AccountMentionedEvent } from 'account/account-mentioned.event';
import type { Account as AccountEntity } from 'account/account.entity';
import { DomainBlockedEvent } from 'account/domain-blocked.event';
import { PostCreatedEvent } from 'post/post-created.event';
import { PostDeletedEvent } from 'post/post-deleted.event';
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
            removeBlockedDomainNotifications: vi.fn(),
            createMentionNotification: vi.fn(),
            removePostNotifications: vi.fn(),
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
                new AccountFollowedEvent(account.id, followerAccount.id),
            );

            expect(
                notificationService.createFollowNotification,
            ).toHaveBeenCalledWith(account.id, followerAccount.id);
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
        it('should create a mention notification', () => {
            const postWithMention = {
                id: 123,
                author: {
                    id: 456,
                },
                content: 'Hello @bob@coolsite.com',
            } as Post;
            const mentionedAccountId = 789;

            events.emit(
                AccountMentionedEvent.getName(),
                new AccountMentionedEvent(postWithMention, mentionedAccountId),
            );

            expect(
                notificationService.createMentionNotification,
            ).toHaveBeenCalledWith(postWithMention, mentionedAccountId);
        });
    });
});
