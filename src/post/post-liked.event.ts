import type { Post } from '@/post/post.entity';

export class PostLikedEvent {
    constructor(
        private readonly post: Post,
        private readonly accountId: number,
    ) {}

    getPost(): Post {
        return this.post;
    }

    getAccountId(): number {
        return this.accountId;
    }

    static getName(): string {
        return 'post.liked';
    }
}
