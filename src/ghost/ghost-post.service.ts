import type EventEmitter from 'node:events';
import type { Logger } from '@logtape/logtape';
import type { Account } from 'account/account.entity';
import {
    type Result,
    error,
    exhaustiveCheck,
    getError,
    getValue,
    isError,
    ok,
} from 'core/result';
import type { Knex } from 'knex';
import { PostDeletedEvent } from 'post/post-deleted.event';
import {
    type CreatePostError,
    type GhostPost,
    Post,
    PostType,
    type PostUpdateParams,
} from 'post/post.entity';
import type { KnexPostRepository } from 'post/post.repository.knex';
import type { DeletePostError, PostService } from 'post/post.service';

export type GhostPostError =
    | CreatePostError
    | 'post-already-exists'
    | 'failed-to-create-post';

export class GhostPostService {
    constructor(
        private readonly db: Knex,
        private readonly postService: PostService,
        private readonly postRepository: KnexPostRepository,
        private readonly logger: Logger,
        private readonly events: EventEmitter,
    ) {}

    async init() {
        this.events.on(
            PostDeletedEvent.getName(),
            this.deleteGhostPostMapping.bind(this),
        );
    }

    async updateArticleFromGhostPost(account: Account, ghostPost: GhostPost) {
        const apId = account.getApIdForPost({
            uuid: ghostPost.uuid,
            type: PostType.Article,
        });

        const postResult = await Post.createArticleFromGhostPost(
            account,
            ghostPost,
        );
        if (isError(postResult)) {
            const error = getError(postResult);
            switch (error) {
                case 'missing-content':
                case 'private-content': {
                    //Remove the post if it's private or empty
                    const deleteResult = await this.postService.deleteByApId(
                        apId,
                        account,
                    );
                    if (isError(deleteResult)) {
                        this.logger.error(
                            'Failed to delete post with apId: {apId}, error: {error}',
                            { apId, error: getError(deleteResult) },
                        );
                    }
                    return;
                }
                default:
                    exhaustiveCheck(error);
            }
        }
        const updatedPost = getValue(postResult);
        const params: PostUpdateParams = {
            title: updatedPost.title,
            content: updatedPost.content,
            excerpt: updatedPost.excerpt,
            summary: updatedPost.summary,
            imageUrl: updatedPost.imageUrl,
            url: updatedPost.url,
            metadata: updatedPost.metadata,
        };

        const updatedPostResult = await this.postService.updateByApId(
            apId,
            account,
            params,
        );
        if (isError(updatedPostResult)) {
            const error = getError(updatedPostResult);
            switch (error) {
                case 'post-not-found': {
                    this.logger.info(
                        'Post not found for apId: {apId}, creating new post',
                        { apId },
                    );
                    const newPostResult = await this.createGhostPost(
                        account,
                        ghostPost,
                    );
                    if (isError(newPostResult)) {
                        this.logger.error(
                            'Failed to create new post with apId: {apId}, error: {error}',
                            { apId, error: getError(newPostResult) },
                        );
                    }
                    return;
                }
                case 'not-author':
                    this.logger.error(
                        'Cannot update post, not authorized for apId: {apId}',
                        { apId },
                    );
                    return;
                default:
                    exhaustiveCheck(error);
            }
        }
    }

    async deleteGhostPost(
        account: Account,
        uuid: string,
    ): Promise<Result<boolean, DeletePostError>> {
        const apId = account.getApIdForPost({
            uuid,
            type: PostType.Article,
        });

        return await this.postService.deleteByApId(apId, account);
    }

    async createGhostPost(
        account: Account,
        data: GhostPost,
    ): Promise<Result<Post, GhostPostError>> {
        const existingPost = await this.getApIdForGhostPost(data.uuid);

        if (existingPost) {
            return error('post-already-exists');
        }

        const postResult = await Post.createArticleFromGhostPost(account, data);
        if (isError(postResult)) {
            return postResult;
        }

        const post = getValue(postResult);
        await this.postRepository.save(post);

        try {
            await this.db('ghost_ap_post_mappings').insert({
                ghost_uuid: data.uuid,
                ap_id: post.apId.href,
            });
        } catch (err) {
            this.logger.error(
                'Failed to create ghost post mapping for apId: {apId}, error: {error}',
                { apId: post.apId.href, error: err },
            );
            await this.postService.deleteByApId(post.apId, account);
            return error('failed-to-create-post');
        }

        return ok(post);
    }

    private async getApIdForGhostPost(ghostUuid: string) {
        const result = await this.db('ghost_ap_post_mappings')
            .select('ap_id')
            .where('ghost_uuid', ghostUuid)
            .first();

        return result?.ap_id ?? null;
    }

    private async deleteGhostPostMapping(event: PostDeletedEvent) {
        const post = event.getPost();
        if (!post.author.isInternal) {
            return;
        }
        await this.db('ghost_ap_post_mappings')
            .whereRaw(
                'ghost_ap_post_mappings.ap_id_hash = UNHEX(SHA2(?, 256))',
                [post.apId.href],
            )
            .delete();
    }
}
