import type { EventEmitter } from 'node:events';

import {
    AccountBlockedEvent,
    AccountFollowedEvent,
    DomainBlockedEvent,
    NotificationsReadEvent,
} from 'account/events';
import type { NotificationService } from 'notification/notification.service';
import { PostCreatedEvent } from 'post/post-created.event';
import { PostDeletedEvent } from 'post/post-deleted.event';
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
            PostDeletedEvent.getName(),
            this.handlePostDeletedEvent.bind(this),
        );
        this.events.on(
            AccountBlockedEvent.getName(),
            this.handleAccountBlockedEvent.bind(this),
        );
        this.events.on(
            DomainBlockedEvent.getName(),
            this.handleDomainBlockedEvent.bind(this),
        );
        this.events.on(
            NotificationsReadEvent.getName(),
            this.handleNotificationsReadEvent.bind(this),
        );
    }

    private async handleAccountFollowedEvent(event: AccountFollowedEvent) {
        await this.notificationService.createFollowNotification(
            event.getAccountId(),
            event.getFollowerId(),
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

        // Create a mention notification for each mention in the post
        const mentions = event.getPost().mentions;
        if (mentions && mentions.length > 0) {
            for (const mention of mentions) {
                await this.notificationService.createMentionNotification(
                    event.getPost(),
                    mention.id,
                );
            }
        }
    }

    private async handlePostDeletedEvent(event: PostDeletedEvent) {
        await this.notificationService.removePostNotifications(event.getPost());
    }

    private async handleAccountBlockedEvent(event: AccountBlockedEvent) {
        const blockerId = event.getBlockerId();
        const blockedId = event.getAccountId();

        await this.notificationService.removeBlockedAccountNotifications(
            blockerId,
            blockedId,
        );
    }

    private async handleDomainBlockedEvent(event: DomainBlockedEvent) {
        const blockerId = event.getBlockerId();
        const domain = event.getDomain();

        await this.notificationService.removeBlockedDomainNotifications(
            blockerId,
            domain,
        );
    }

    private async handleNotificationsReadEvent(event: NotificationsReadEvent) {
        const accountId = event.getAccountId();

        await this.notificationService.readAllNotifications(accountId);
    }
}
