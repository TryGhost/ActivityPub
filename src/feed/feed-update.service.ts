import type { EventEmitter } from 'node:events';

import {
    AccountBlockedEvent,
    AccountUnfollowedEvent,
    DomainBlockedEvent,
} from '@/account/events';
import type { FeedService } from '@/feed/feed.service';
import { isFollowersOnlyPost, isPublicPost } from '@/post/post.entity';
import type { KnexPostRepository } from '@/post/post.repository.knex';
import { PostCreatedEvent } from '@/post/post-created.event';
import { PostDeletedEvent } from '@/post/post-deleted.event';
import { PostDerepostedEvent } from '@/post/post-dereposted.event';
import { PostRepostedEvent } from '@/post/post-reposted.event';

export class FeedUpdateService {
    constructor(
        private readonly events: EventEmitter,
        private readonly feedService: FeedService,
        private readonly postRepository: KnexPostRepository,
    ) {}

    init() {
        this.events.on(
            PostCreatedEvent.getName(),
            this.handlePostCreatedEvent.bind(this),
        );
        this.events.on(
            PostRepostedEvent.getName(),
            this.handlePostRepostedEvent.bind(this),
        );
        this.events.on(
            PostDeletedEvent.getName(),
            this.handlePostDeletedEvent.bind(this),
        );
        this.events.on(
            PostDerepostedEvent.getName(),
            this.handlePostDerepostedEvent.bind(this),
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
            AccountUnfollowedEvent.getName(),
            this.handleAccountUnfollowedEvent.bind(this),
        );
    }

    private async handlePostCreatedEvent(event: PostCreatedEvent) {
        const post = await this.postRepository.getById(event.getPostId());

        if (!post) {
            return;
        }

        if (isPublicPost(post) || isFollowersOnlyPost(post)) {
            await this.feedService.addPostToFeeds(post);
            await this.feedService.addPostToDiscoveryFeeds(post);
        }
    }

    private async handlePostRepostedEvent(event: PostRepostedEvent) {
        const post = await this.postRepository.getById(event.getPostId());

        if (!post) {
            return; // Post was deleted
        }

        const repostedBy = event.getAccountId();

        if (isPublicPost(post) || isFollowersOnlyPost(post)) {
            await this.feedService.addPostToFeeds(post, repostedBy);
        }
    }

    private async handlePostDeletedEvent(event: PostDeletedEvent) {
        const post = event.getPost();

        if (post.id !== null) {
            await this.feedService.removePostFromFeeds(post.id);
        }
        await this.feedService.removePostFromDiscoveryFeeds(post);
    }

    private async handlePostDerepostedEvent(event: PostDerepostedEvent) {
        await this.feedService.removePostFromFeeds(
            event.getPostId(),
            event.getAccountId(),
        );
    }

    private async handleAccountBlockedEvent(event: AccountBlockedEvent) {
        const blockerId = event.getBlockerId();
        const blockedId = event.getAccountId();

        await this.feedService.removeBlockedAccountPostsFromFeed(
            blockerId,
            blockedId,
        );
    }

    private async handleDomainBlockedEvent(event: DomainBlockedEvent) {
        const blockerId = event.getBlockerId();
        const domain = event.getDomain();

        await this.feedService.removeBlockedDomainPostsFromFeed(
            blockerId,
            domain,
        );
    }

    private async handleAccountUnfollowedEvent(event: AccountUnfollowedEvent) {
        const unfollowerId = event.getUnfollowerId();
        const accountId = event.getAccountId();

        await this.feedService.removeUnfollowedAccountPostsFromFeed(
            unfollowerId,
            accountId,
        );
    }
}
