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
    PostType,
    type PostUpdateParams,
} from '@/post/post.entity';
import type { KnexPostRepository } from '@/post/post.repository.knex';
import type { DeletePostError, PostService } from '@/post/post.service';
import { PostDeletedEvent } from '@/post/post-deleted.event';

type GhostPostError =
    | CreatePostError
    | 'post-already-exists'
    | 'failed-to-create-post'
    | 'not-shared';

type DeleteGhostPostError = DeletePostError | 'post-not-found';

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

    async updateGhostPost(account: Account, ghostPost: GhostPost) {
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

        // The post should no longer be shared, so remove it
        if (ghostPost.social_web_share === 'none') {
            await this.removePost(apId, account);
            return;
        }

        // A post shared as a Note is not updated when the Ghost post is
        // edited: notes can't be edited yet, and updating it from the post
        // would replace the note with the full content of the post
        const existingPost = await this.postRepository.getByApId(apId);
        if (existingPost?.type === PostType.Note) {
            this.logger.info(
                'Not updating post: Ghost post with UUID {uuid} was shared as a note',
                {
                    uuid: ghostPost.uuid,
                },
            );
            return;
        }

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
                    await this.removePost(apId, account);
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

    private async removePost(apId: URL, account: Account) {
        const deleteResult = await this.postService.deleteByApId(apId, account);
        if (isError(deleteResult)) {
            this.logger.error(
                'Failed to delete post with apId: {apId}, error: {error}',
                { apId, error: getError(deleteResult) },
            );
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

    /**
     * Share a published Ghost post, as an Article or a Note depending on
     * the post's `social_web_share` setting
     *
     * Returns a `not-shared` error when the post should not be shared
     */
    async createGhostPost(
        account: Account,
        data: GhostPost,
    ): Promise<Result<Post, GhostPostError>> {
        const shareMode = data.social_web_share ?? 'article';

        if (shareMode === 'none') {
            return error('not-shared');
        }

        const existingPost = await this.getApIdForGhostPost(data.uuid);

        if (existingPost) {
            return error('post-already-exists');
        }

        let post: Post;

        if (shareMode === 'note') {
            post = Post.createNoteFromGhostPost(account, data);
        } else {
            const postResult = await Post.createArticleFromGhostPost(
                account,
                data,
            );
            if (isError(postResult)) {
                return postResult;
            }
            post = getValue(postResult);
        }

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
        if (!event.isAuthorInternal()) {
            return;
        }
        await this.db('ghost_ap_post_mappings')
            .whereRaw(
                'ghost_ap_post_mappings.ap_id_hash = UNHEX(SHA2(?, 256))',
                [event.getPostApId()],
            )
            .delete();
    }
}
