import type { Logger } from '@logtape/logtape';

import { AccountFollowedEvent, AccountUnfollowedEvent } from '@/account/events';
import type { NodeInfoService } from '@/activitypub/nodeinfo.service';
import type { AsyncEvents } from '@/core/events';
import { PostCreatedEvent } from '@/post/post-created.event';
import { PostDeletedEvent } from '@/post/post-deleted.event';
import { PostDerepostedEvent } from '@/post/post-dereposted.event';
import { PostLikedEvent } from '@/post/post-liked.event';
import { PostRepostedEvent } from '@/post/post-reposted.event';
import { PostUnlikedEvent } from '@/post/post-unliked.event';
import { PostUpdatedEvent } from '@/post/post-updated.event';

export class NodeInfoEventService {
    constructor(
        private readonly events: AsyncEvents,
        private readonly nodeInfoService: NodeInfoService,
        private readonly logging: Logger,
    ) {}

    init() {
        this.events.on(
            PostCreatedEvent.getName(),
            async (event: PostCreatedEvent) => {
                await this.markActive(
                    () =>
                        this.nodeInfoService.markPostAuthorActive(
                            event.getPostId(),
                        ),
                    PostCreatedEvent.getName(),
                );
            },
        );

        this.events.on(
            PostUpdatedEvent.getName(),
            async (event: PostUpdatedEvent) => {
                await this.markActive(
                    () =>
                        this.nodeInfoService.markPostAuthorActive(
                            event.getPostId(),
                        ),
                    PostUpdatedEvent.getName(),
                );
            },
        );

        this.events.on(
            PostDeletedEvent.getName(),
            async (event: PostDeletedEvent) => {
                if (event.isAuthorInternal()) {
                    await this.markActive(
                        () =>
                            this.nodeInfoService.markAccountActive(
                                event.getAccountId(),
                            ),
                        PostDeletedEvent.getName(),
                    );
                }
            },
        );

        this.events.on(
            PostLikedEvent.getName(),
            async (event: PostLikedEvent) => {
                await this.markActive(
                    () =>
                        this.nodeInfoService.markAccountActive(
                            event.getAccountId(),
                        ),
                    PostLikedEvent.getName(),
                );
            },
        );

        this.events.on(
            PostUnlikedEvent.getName(),
            async (event: PostUnlikedEvent) => {
                await this.markActive(
                    () =>
                        this.nodeInfoService.markAccountActive(
                            event.getAccountId(),
                        ),
                    PostUnlikedEvent.getName(),
                );
            },
        );

        this.events.on(
            PostRepostedEvent.getName(),
            async (event: PostRepostedEvent) => {
                await this.markActive(
                    () =>
                        this.nodeInfoService.markAccountActive(
                            event.getAccountId(),
                        ),
                    PostRepostedEvent.getName(),
                );
            },
        );

        this.events.on(
            PostDerepostedEvent.getName(),
            async (event: PostDerepostedEvent) => {
                await this.markActive(
                    () =>
                        this.nodeInfoService.markAccountActive(
                            event.getAccountId(),
                        ),
                    PostDerepostedEvent.getName(),
                );
            },
        );

        this.events.on(
            AccountFollowedEvent.getName(),
            async (event: AccountFollowedEvent) => {
                await this.markActive(
                    () =>
                        this.nodeInfoService.markAccountActive(
                            event.getFollowerId(),
                        ),
                    AccountFollowedEvent.getName(),
                );
            },
        );

        this.events.on(
            AccountUnfollowedEvent.getName(),
            async (event: AccountUnfollowedEvent) => {
                await this.markActive(
                    () =>
                        this.nodeInfoService.markAccountActive(
                            event.getUnfollowerId(),
                        ),
                    AccountUnfollowedEvent.getName(),
                );
            },
        );
    }

    private async markActive(
        fn: () => Promise<void>,
        eventName: string,
    ): Promise<void> {
        try {
            await fn();
        } catch (err) {
            this.logging.warn('Failed to update NodeInfo activity marker', {
                eventName,
                error: err,
            });
        }
    }
}
