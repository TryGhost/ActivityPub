import type { EventEmitter } from 'node:events';
import { AccountFollowedEvent } from 'account/account-followed.event';
import type { NotificationService } from 'notification/notification.service';
import { PostCreatedEvent } from 'post/post-created.event';

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
        this.events.on(
            PostCreatedEvent.getName(),
            this.handlePostCreatedEvent.bind(this),
        );
    }

    private async handleAccountFollowedEvent(event: AccountFollowedEvent) {
        await this.notificationService.createFollowNotification(
            event.getAccount(),
            event.getFollower(),
        );
    }

    private async handlePostCreatedEvent(event: PostCreatedEvent) {
        await this.notificationService.createReplyNotification(event.getPost());
    }
}
