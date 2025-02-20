import type { EventEmitter } from 'node:events';

import type { FeedService } from 'feed/feed.service';
import { FeedsUpdatedEventUpdateOperation } from 'feed/feeds-updated.event';
import { FeedsUpdatedEvent } from 'feed/feeds-updated.event';
import { PostCreatedEvent } from 'post/post-created.event';
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
    }

    private async handlePostCreatedEvent(event: PostCreatedEvent) {
        const post = event.getPost();

        let updatedFeedUserIds: number[] = [];

        if (isPublicPost(post) || isFollowersOnlyPost(post)) {
            updatedFeedUserIds = await this.feedService.addPostToFeeds(post);
        }

        if (updatedFeedUserIds.length > 0) {
            this.events.emit(
                FeedsUpdatedEvent.getName(),
                new FeedsUpdatedEvent(
                    updatedFeedUserIds,
                    FeedsUpdatedEventUpdateOperation.PostAdded,
                    post,
                ),
            );
        }
    }

    private async handlePostRepostedEvent(event: PostRepostedEvent) {
        const post = event.getPost();
        const repostedBy = event.getAccountId();

        let updatedFeedUserIds: number[] = [];

        if (isPublicPost(post) || isFollowersOnlyPost(post)) {
            updatedFeedUserIds = await this.feedService.addPostToFeeds(
                post,
                repostedBy,
            );
        }

        if (updatedFeedUserIds.length > 0) {
            this.events.emit(
                FeedsUpdatedEvent.getName(),
                new FeedsUpdatedEvent(
                    updatedFeedUserIds,
                    FeedsUpdatedEventUpdateOperation.PostAdded,
                    post,
                ),
            );
        }
    }
}
