import type { EventEmitter } from 'node:events';

import { AccountBlockedEvent } from 'account/account-blocked.event';
import { AccountFollowedEvent } from 'account/account-followed.event';
import type { NotificationService } from 'notification/notification.service';
import { PostCreatedEvent } from 'post/post-created.event';
import { PostLikedEvent } from 'post/post-liked.event';
import { PostRepostedEvent } from 'post/post-reposted.event';

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
            PostLikedEvent.getName(),
            this.handlePostLikedEvent.bind(this),
        );
        this.events.on(
            PostRepostedEvent.getName(),
            this.handlePostRepostedEvent.bind(this),
        );
        this.events.on(
            PostCreatedEvent.getName(),
            this.handlePostCreatedEvent.bind(this),
        );
        this.events.on(
            AccountBlockedEvent.getName(),
            this.handleAccountBlockedEvent.bind(this),
        );
    }

    private async handleAccountFollowedEvent(event: AccountFollowedEvent) {
        await this.notificationService.createFollowNotification(
            event.getAccount(),
            event.getFollower(),
        );
    }

    private async handlePostLikedEvent(event: PostLikedEvent) {
        await this.notificationService.createLikeNotification(
            event.getPost(),
            event.getAccountId(),
        );
    }

    private async handlePostRepostedEvent(event: PostRepostedEvent) {
        await this.notificationService.createRepostNotification(
            event.getPost(),
            event.getAccountId(),
        );
    }

    private async handlePostCreatedEvent(event: PostCreatedEvent) {
        await this.notificationService.createReplyNotification(event.getPost());
    }

    private async handleAccountBlockedEvent(event: AccountBlockedEvent) {
        const blockerId = event.getBlockerId();
        const blockedId = event.getAccountId();

        await this.notificationService.removeBlockedAccountNotifications(
            blockerId,
            blockedId,
        );
    }
}
