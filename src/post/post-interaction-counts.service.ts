import { Article, type Collection, Note } from '@fedify/fedify';
import type { FedifyContextFactory } from 'activitypub/fedify-context.factory';
import { lookupObject } from 'lookup-helpers';
import type { KnexPostRepository } from './post.repository.knex';

export class PostInteractionCountsService {
    constructor(
        private readonly postRepository: KnexPostRepository,
        private readonly fedifyContextFactory: FedifyContextFactory,
    ) {}

    /**
     * Refresh the like/repost counts for a post, by remotely fetching the ActivityPub Note/Article
     *
     * @param postId The ID of the post to refresh the like/repost counts for
     */
    async refreshInteractionCounts(postId: number) {
        const post = await this.postRepository.getById(postId);

        if (!post) {
            return;
        }

        const context = this.fedifyContextFactory.getFedifyContext();
        const object = await lookupObject(context, post.apId);

        if (!object || !(object instanceof Note || object instanceof Article)) {
            return;
        }

        let likeCount = await this.getLikesCount(object);
        let repostCount = await this.getRepostsCount(object);

        if (likeCount === post.likeCount) {
            likeCount = undefined;
        }

        if (repostCount === post.repostCount) {
            repostCount = undefined;
        }

        if (likeCount === undefined && repostCount === undefined) {
            return;
        }

        // Only update counts if they have changed
        await this.postRepository.updateInteractionCounts(
            post.id!,
            likeCount,
            repostCount,
        );
    }

    private async getLikesCount(object: Note | Article) {
        let likesCollection: Collection | null;
        try {
            likesCollection = await object.getLikes();
        } catch {
            likesCollection = null;
        }

        if (!likesCollection) {
            return undefined;
        }

        return likesCollection.totalItems ?? undefined;
    }

    private async getRepostsCount(object: Note | Article) {
        let sharesCollection: Collection | null;
        try {
            sharesCollection = await object.getShares();
        } catch {
            sharesCollection = null;
        }

        if (!sharesCollection) {
            return undefined;
        }

        return sharesCollection.totalItems ?? undefined;
    }
}
