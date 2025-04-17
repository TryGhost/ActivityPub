import { Article, Note, lookupObject } from '@fedify/fedify';
import type { AccountService } from 'account/account.service';
import type { FedifyContextFactory } from 'activitypub/fedify-context.factory';
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
import { Post, type PostAttachment, PostType } from './post.entity';
import type { KnexPostRepository } from './post.repository.knex';

export type GetByApIdError = 'upstream-error' | 'not-a-post' | 'missing-author';

export type GetPostsError =
    | 'invalid-next-parameter'
    | 'error-getting-outbox'
    | 'no-page-found'
    | 'not-an-actor';

export class PostService {
    constructor(
        private readonly postRepository: KnexPostRepository,
        private readonly accountService: AccountService,
        private readonly db: Knex,
        private readonly fedifyContextFactory: FedifyContextFactory,
    ) {}

    /**
     * Get the attachments for a post
     *
     * @param attachments
     */
    private async getPostAttachments(
        foundObject: Note | Article,
    ): Promise<PostAttachment[]> {
        const attachments = foundObject.getAttachments();
        const postAttachments: PostAttachment[] = [];

        for await (const attachment of attachments) {
            if (attachment instanceof Object) {
                const attachmentList = Array.isArray(attachment)
                    ? attachment
                    : [attachment].filter((a) => a !== undefined);
                for (const a of attachmentList) {
                    postAttachments.push({
                        type: a.type,
                        mediaType: a.mediaType,
                        name: a.name,
                        url: a.url,
                    });
                }
            }
        }
        return postAttachments;
    }

    async getByApId(id: URL): Promise<Result<Post, GetByApIdError>> {
        const post = await this.postRepository.getByApId(id);
        if (post) {
            return ok(post);
        }

        const context = this.fedifyContextFactory.getFedifyContext();

        const documentLoader = await context.getDocumentLoader({
            handle: 'index',
        });
        const foundObject = await lookupObject(id, { documentLoader });

        // If foundObject is null - we could not find anything for this URL
        // Error because could be upstream server issues and we want a retry
        if (foundObject === null) {
            return error('upstream-error');
        }

        // If we do find an Object, and it's not a Note or Article
        // we return null because we're unable to handle it.
        if (
            !(foundObject instanceof Note) &&
            !(foundObject instanceof Article)
        ) {
            return error('not-a-post');
        }

        const type =
            foundObject instanceof Note ? PostType.Note : PostType.Article;

        // We're also unable to handle objects without an author
        if (!foundObject.attributionId) {
            return error('missing-author');
        }

        const author = await this.accountService.getByApId(
            foundObject.attributionId,
        );

        if (author === null) {
            return error('missing-author');
        }

        let inReplyTo = null;
        if (foundObject.replyTargetId) {
            const found = await this.getByApId(foundObject.replyTargetId);
            if (isError(found)) {
                const error = getError(found);
                switch (error) {
                    case 'upstream-error':
                        break;
                    case 'not-a-post':
                        break;
                    case 'missing-author':
                        break;
                    default: {
                        exhaustiveCheck(error);
                    }
                }
            } else {
                inReplyTo = getValue(found);
            }
        }

        const newlyCreatedPost = Post.createFromData(author, {
            type,
            title: foundObject.name?.toString(),
            content: foundObject.content?.toString(),
            imageUrl: foundObject.imageId,
            publishedAt: new Date(foundObject.published?.toString() || ''),
            url: foundObject.url instanceof URL ? foundObject.url : id,
            apId: id,
            inReplyTo,
            attachments: await this.getPostAttachments(foundObject),
        });

        await this.postRepository.save(newlyCreatedPost);

        return ok(newlyCreatedPost);
    }

    /**
     * Check if a post is liked by an account
     *
     * @param postId ID of the post to check
     * @param accountId ID of the account to check
     * @returns True if the post is liked by the account, false otherwise
     */
    async isLikedByAccount(postId: number, accountId: number) {
        return this.postRepository.isLikedByAccount(postId, accountId);
    }

    /**
     * Check if a post is reposted by an account
     *
     * @param postId ID of the post to check
     * @param accountId ID of the account to check
     * @returns True if the post is reposted by the account, false otherwise
     */
    async isRepostedByAccount(postId: number, accountId: number) {
        return this.postRepository.isRepostedByAccount(postId, accountId);
    }
}
