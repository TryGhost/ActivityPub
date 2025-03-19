import type { Post } from './post.entity';

export class PostCreatedEvent {
    constructor(private readonly postId: Post['id']) {}

    getPostId(): Post['id'] {
        return this.postId;
    }

    static getName(): string {
        return 'post.created';
    }
}
