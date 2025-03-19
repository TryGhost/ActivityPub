import type { EventEmitter } from 'node:events';

import type { FeedService } from 'feed/feed.service';
import { FeedsUpdatedEventUpdateOperation } from 'feed/feeds-updated.event';
import { FeedsUpdatedEvent } from 'feed/feeds-updated.event';
import { PostCreatedEvent } from 'post/post-created.event';
import { PostDeletedEvent } from 'post/post-deleted.event';
import { PostDerepostedEvent } from 'post/post-dereposted.event';
import { PostRepostedEvent } from 'post/post-reposted.event';
import { isFollowersOnlyPost, isPublicPost } from 'post/post.entity';
import type { KnexPostRepository } from 'post/post.repository.knex';

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
    }

    private async handlePostCreatedEvent(event: PostCreatedEvent) {
        const postId = event.getPostId();
        const post = await this.postRepository.getById(postId);

        if (!post) {
            return;
        }

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

    private async handlePostDeletedEvent(event: PostDeletedEvent) {
        const post = event.getPost();

        const updatedFeedUserIds =
            await this.feedService.removePostFromFeeds(post);

        if (updatedFeedUserIds.length > 0) {
            this.events.emit(
                FeedsUpdatedEvent.getName(),
                new FeedsUpdatedEvent(
                    updatedFeedUserIds,
                    FeedsUpdatedEventUpdateOperation.PostRemoved,
                    post,
                ),
            );
        }
    }

    private async handlePostDerepostedEvent(event: PostDerepostedEvent) {
        const post = event.getPost();
        const derepostedBy = event.getAccountId();

        const updatedFeedUserIds = await this.feedService.removePostFromFeeds(
            post,
            derepostedBy,
        );

        if (updatedFeedUserIds.length > 0) {
            this.events.emit(
                FeedsUpdatedEvent.getName(),
                new FeedsUpdatedEvent(
                    updatedFeedUserIds,
                    FeedsUpdatedEventUpdateOperation.PostRemoved,
                    post,
                ),
            );
        }
    }
}
