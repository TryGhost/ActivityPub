import type { Post } from '../post/post.entity';

export enum FeedsUpdatedEventUpdateOperation {
    PostAdded = 'post.added',
    PostRemoved = 'post.removed',
}

export class FeedsUpdatedEvent {
    constructor(
        public readonly userIds: number[],
        public readonly updateOperation: FeedsUpdatedEventUpdateOperation,
        public readonly post: Post,
    ) {}

    static getName(): string {
        return 'feeds.updated';
    }
}
