import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EventEmitter } from 'node:events';

import { AccountFollowedEvent } from 'account/account-followed.event';
import type { Account } from 'account/types';
import { PostLikedEvent } from 'post/post-liked.event';
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
});
