export class PostUpdatedEvent {
    constructor(private readonly postId: number) {}

    getPostId(): number {
        return this.postId;
    }

    static getName(): string {
        return 'post.updated';
    }
}
