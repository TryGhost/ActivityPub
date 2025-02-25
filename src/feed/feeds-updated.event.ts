import type { Post } from '../post/post.entity';

export enum FeedsUpdatedEventUpdateOperation {
    PostAdded = 'post.added',
    PostRemoved = 'post.removed',
}

export class FeedsUpdatedEvent {
    constructor(
        private readonly userIds: number[],
        private readonly updateOperation: FeedsUpdatedEventUpdateOperation,
        private readonly post: Post,
    ) {}

    getUserIds(): number[] {
        return this.userIds;
    }

    getUpdateOperation(): FeedsUpdatedEventUpdateOperation {
        return this.updateOperation;
    }

    getPost(): Post {
        return this.post;
    }

    static getName(): string {
        return 'feeds.updated';
    }
}
