import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EventEmitter } from 'node:events';

import { AccountFollowedEvent } from 'account/account-followed.event';
import type { Account } from 'account/types';
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
});
