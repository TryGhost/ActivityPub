import type { Post } from '@/post/post.entity';

export class PostUpdatedEvent {
    constructor(private readonly post: Post) {}

    getPost(): Post {
        return this.post;
    }

    static getName(): string {
        return 'post.updated';
    }
}
