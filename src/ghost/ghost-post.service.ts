import type EventEmitter from 'node:events';

import type { Logger } from '@logtape/logtape';
import type { Knex } from 'knex';

import type { Account } from '@/account/account.entity';
import {
    error,
    exhaustiveCheck,
    getError,
    getValue,
    isError,
    ok,
    type Result,
} from '@/core/result';
import {
    type CreatePostError,
    type GhostPost,
    Post,
    type PostUpdateParams,
} from '@/post/post.entity';
import type { KnexPostRepository } from '@/post/post.repository.knex';
import type { DeletePostError, PostService } from '@/post/post.service';
import { PostDeletedEvent } from '@/post/post-deleted.event';

export type GhostPostError =
    | CreatePostError
    | 'post-already-exists'
    | 'failed-to-create-post';

export type DeleteGhostPostError = DeletePostError | 'post-not-found';

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
        const apIdForPost = await this.getApIdForGhostPost(ghostPost.uuid);
        if (!apIdForPost) {
            this.logger.info(
                'Could not update post: Ghost post with UUID {uuid} was not found.',
                {
                    uuid: ghostPost.uuid,
                },
            );
            return;
        }
        const apId = new URL(apIdForPost);

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
                    this.logger.error('Could not update post: post not found', {
                        apId,
                    });
                    return;
                }
                case 'not-author':
                    this.logger.error(
                        'Could not update post: actor is not the author of the post',
                        {
                            apId,
                        },
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
    ): Promise<Result<boolean, DeleteGhostPostError>> {
        const apIdForPost = await this.getApIdForGhostPost(uuid);
        if (!apIdForPost) {
            return error('post-not-found');
        }
        const apId = new URL(apIdForPost);
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
