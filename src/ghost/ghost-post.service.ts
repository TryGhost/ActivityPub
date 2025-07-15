import type { Logger } from '@logtape/logtape';
import type { Account } from 'account/account.entity';
import { exhaustiveCheck, getError, getValue, isError } from 'core/result';
import {
    type GhostPost,
    Post,
    PostType,
    type PostUpdateParams,
} from 'post/post.entity';
import type { PostService } from 'post/post.service';

export class GhostPostService {
    constructor(
        private readonly postService: PostService,
        private readonly logger: Logger,
    ) {}

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
                    const newPostResult =
                        await this.postService.handleIncomingGhostPost(
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
}
