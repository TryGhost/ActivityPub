import type { EventEmitter } from 'node:events';

import type { FeedService } from 'feed/feed.service';
import { PostCreatedEvent } from 'post/post-created.event';
import { PostDeletedEvent } from 'post/post-deleted.event';
import { PostDerepostedEvent } from 'post/post-dereposted.event';
import { PostRepostedEvent } from 'post/post-reposted.event';
import { isFollowersOnlyPost, isPublicPost } from 'post/post.entity';

export class FeedUpdateService {
    constructor(
        private readonly events: EventEmitter,
        private readonly feedService: FeedService,
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
    }

    private async handlePostCreatedEvent(event: PostCreatedEvent) {
        const post = event.getPost();

        if (isPublicPost(post) || isFollowersOnlyPost(post)) {
            await this.feedService.addPostToFeeds(post);
        }
    }

    private async handlePostRepostedEvent(event: PostRepostedEvent) {
        const post = event.getPost();
        const repostedBy = event.getAccountId();

        if (isPublicPost(post) || isFollowersOnlyPost(post)) {
            await this.feedService.addPostToFeeds(post, repostedBy);
        }
    }

    private async handlePostDeletedEvent(event: PostDeletedEvent) {
        const post = event.getPost();

        await this.feedService.removePostFromFeeds(post);
    }

    private async handlePostDerepostedEvent(event: PostDerepostedEvent) {
        const post = event.getPost();
        const derepostedBy = event.getAccountId();

        await this.feedService.removePostFromFeeds(post, derepostedBy);
    }
}
