import type { EventEmitter } from 'node:events';

import {
    AccountBlockedEvent,
    AccountFollowedEvent,
    DomainBlockedEvent,
    NotificationsReadEvent,
} from '@/account/events';
import type { NotificationService } from '@/notification/notification.service';
import type { KnexPostRepository } from '@/post/post.repository.knex';
import { PostCreatedEvent } from '@/post/post-created.event';
import { PostDeletedEvent } from '@/post/post-deleted.event';
import { PostLikedEvent } from '@/post/post-liked.event';
import { PostRepostedEvent } from '@/post/post-reposted.event';

export class NotificationEventService {
    constructor(
        private readonly events: EventEmitter,
        private readonly notificationService: NotificationService,
        private readonly postRepository: KnexPostRepository,
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
            event.getPostId(),
            event.getPostAuthorId(),
            event.getAccountId(),
        );
    }

    private async handlePostRepostedEvent(event: PostRepostedEvent) {
        const post = await this.postRepository.getById(event.getPostId());

        if (!post) {
            return; // Post was deleted
        }

        await this.notificationService.createRepostNotification(
            post,
            event.getAccountId(),
        );
    }

    private async handlePostCreatedEvent(event: PostCreatedEvent) {
        const post = await this.postRepository.getById(event.getPostId());

        if (!post) {
            return;
        }

        await this.notificationService.createReplyNotification(post);

        // Create a mention notification for each mention in the post
        const mentions = post.mentions;
        if (mentions && mentions.length > 0) {
            for (const mention of mentions) {
                await this.notificationService.createMentionNotification(
                    post,
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
