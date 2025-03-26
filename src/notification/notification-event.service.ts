import type { EventEmitter } from 'node:events';
import { AccountFollowedEvent } from 'account/account-followed.event';
import type { NotificationService } from 'notification/notification.service';

export class NotificationEventService {
    constructor(
        private readonly events: EventEmitter,
        private readonly notificationService: NotificationService,
    ) {}

    init() {
        this.events.on(
            AccountFollowedEvent.getName(),
            this.handleAccountFollowedEvent.bind(this),
        );
    }

    private async handleAccountFollowedEvent(event: AccountFollowedEvent) {
        await this.notificationService.createFollowNotification(
            event.getAccount(),
            event.getFollower(),
        );
    }
}
