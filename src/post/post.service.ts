import {
    Article,
    Mention as FedifyMention,
    Note,
    lookupObject,
} from '@fedify/fedify';
import * as Sentry from '@sentry/node';
import type { Account } from 'account/account.entity';
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
import {
    getLikeCountFromRemote,
    getRepostCountFromRemote,
    lookupActorProfile,
} from 'lookup-helpers';
import type { ModerationService } from 'moderation/moderation.service';
import type {
    GCPStorageService,
    ImageVerificationError,
} from 'storage/gcloud-storage/gcp-storage.service';
import { ContentPreparer } from './content';
import {
    type CreatePostError,
    type GhostPost,
    type Mention,
    Post,
    type PostAttachment,
    PostType,
} from './post.entity';
import type { KnexPostRepository } from './post.repository.knex';

export type GetByApIdError = 'upstream-error' | 'not-a-post' | 'missing-author';

export type InteractionError = 'cannot-interact';

export type GetPostsError =
    | 'invalid-next-parameter'
    | 'error-getting-outbox'
    | 'no-page-found'
    | 'not-an-actor';

export type RepostError =
    | GetByApIdError
    | 'already-reposted'
    | InteractionError;

export type GhostPostError = CreatePostError | 'post-already-exists';

export const INTERACTION_COUNTS_NOT_FOUND = 'interaction-counts-not-found';
export type UpdateInteractionCountsError =
    | 'post-not-found'
    | 'post-is-internal'
    | 'upstream-error'
    | 'not-a-post'
    | typeof INTERACTION_COUNTS_NOT_FOUND;

export class PostService {
    constructor(
        private readonly postRepository: KnexPostRepository,
        private readonly accountService: AccountService,
        private readonly fedifyContextFactory: FedifyContextFactory,
        private readonly storageService: GCPStorageService,
        private readonly moderationService: ModerationService,
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

    private async getMentionedAccounts(
        object: Note | Article,
    ): Promise<Mention[]> {
        const mentions: Mention[] = [];
        for await (const tag of object.getTags()) {
            if (tag instanceof FedifyMention) {
                if (!tag.href) {
                    continue;
                }

                if (!tag.name) {
                    continue;
                }

                const accountResult = await this.accountService.ensureByApId(
                    tag.href,
                );
                if (isError(accountResult)) {
                    continue;
                }

                const account = getValue(accountResult);
                mentions.push({
                    name: tag.name.toString(),
                    href: tag.href,
                    account,
                });
            }
        }

        return mentions;
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
                let errorMessage: string;
                switch (error) {
                    case 'upstream-error':
                        errorMessage = `Failed to fetch parent post for reply ${foundObject.id}, parent id : ${foundObject.replyTargetId}`;
                        break;
                    case 'not-a-post':
                        errorMessage = `Parent post for reply ${foundObject.id}, parent id : ${foundObject.replyTargetId}, is not an instance of Note or Article`;
                        break;
                    case 'missing-author':
                        errorMessage = `Parent post for reply ${foundObject.id}, parent id : ${foundObject.replyTargetId}, has no author`;
                        break;
                    default: {
                        exhaustiveCheck(error);
                    }
                }
                const err = new Error(errorMessage);
                Sentry.captureException(err);
                context.data.logger.error(errorMessage);
            } else {
                inReplyTo = getValue(found);
            }
        }

        const mentions = await this.getMentionedAccounts(foundObject);

        const newlyCreatedPost = Post.createFromData(author, {
            type,
            title: foundObject.name?.toString(),
            summary: foundObject.summary?.toString() ?? null,
            content: foundObject.content?.toString(),
            imageUrl: foundObject.imageId,
            publishedAt: new Date(foundObject.published?.toString() || ''),
            url: foundObject.url instanceof URL ? foundObject.url : id,
            apId: id,
            inReplyTo,
            mentions,
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

    private async getMentionsFromContent(content: string): Promise<Mention[]> {
        const ctx = this.fedifyContextFactory.getFedifyContext();
        const mentions = ContentPreparer.parseMentions(content);
        const processedMentions: Mention[] = [];

        for (const mention of mentions) {
            let account: Account | null = null;
            const lookupResult = await lookupActorProfile(ctx, mention);
            if (isError(lookupResult)) {
                ctx.data.logger.info(
                    `Failed to lookup apId for mention: ${mention}, error: ${getError(lookupResult)}`,
                );
                continue;
            }

            const accountResult = await this.accountService.ensureByApId(
                getValue(lookupResult),
            );
            if (isError(accountResult)) {
                ctx.data.logger.info(
                    `Failed to lookup account for mention: ${mention}, error: ${getError(accountResult)}`,
                );
                continue;
            }
            account = getValue(accountResult);

            processedMentions.push({
                name: mention,
                href: account.url,
                account: account,
            });
        }

        return processedMentions;
    }

    async createNote(
        account: Account,
        content: string,
        image?: URL,
    ): Promise<Result<Post, ImageVerificationError>> {
        if (image) {
            const result = await this.storageService.verifyImageUrl(image);
            if (isError(result)) {
                return result;
            }
        }

        const mentions = await this.getMentionsFromContent(content);

        const post = Post.createNote(account, content, image, mentions);

        await this.postRepository.save(post);

        return ok(post);
    }

    async createReply(
        account: Account,
        content: string,
        inReplyToId: URL,
        image?: URL,
    ): Promise<
        Result<Post, ImageVerificationError | GetByApIdError | InteractionError>
    > {
        if (image) {
            const result = await this.storageService.verifyImageUrl(image);
            if (isError(result)) {
                return result;
            }
        }

        const mentions = await this.getMentionsFromContent(content);

        const inReplyToResult = await this.getByApId(inReplyToId);

        if (isError(inReplyToResult)) {
            return inReplyToResult;
        }

        const inReplyTo = getValue(inReplyToResult);

        const canInteract = await this.moderationService.canInteractWithAccount(
            account.id,
            inReplyTo.author.id,
        );

        if (!canInteract) {
            return error('cannot-interact');
        }

        const post = Post.createReply(
            account,
            content,
            inReplyTo,
            image,
            mentions,
        );

        await this.postRepository.save(post);

        return ok(post);
    }

    async likePost(
        account: Account,
        post: Post,
    ): Promise<Result<Post, InteractionError>> {
        const canInteract = await this.moderationService.canInteractWithAccount(
            account.id,
            post.author.id,
        );

        if (!canInteract) {
            return error('cannot-interact');
        }

        post.addLike(account);

        await this.postRepository.save(post);

        return ok(post);
    }

    async repostByApId(
        account: Account,
        postId: URL,
    ): Promise<Result<Post, RepostError>> {
        const postToRepostResult = await this.getByApId(postId);

        if (isError(postToRepostResult)) {
            return postToRepostResult;
        }

        const post = getValue(postToRepostResult);

        const canInteract = await this.moderationService.canInteractWithAccount(
            account.id,
            post.author.id,
        );

        if (!canInteract) {
            return error('cannot-interact');
        }

        // We know this is not `null` because it just came from the DB
        const reposted = await this.isRepostedByAccount(post.id!, account.id);

        if (reposted) {
            return error('already-reposted');
        }

        post.addRepost(account);

        await this.postRepository.save(post);

        return ok(post);
    }

    async handleIncomingGhostPost(
        account: Account,
        ghostPost: GhostPost,
    ): Promise<Result<Post, GhostPostError>> {
        const postResult = await Post.createArticleFromGhostPost(
            account,
            ghostPost,
        );

        if (isError(postResult)) {
            return postResult;
        }

        const post = getValue(postResult);

        const existingPost = await this.postRepository.getByApId(post.apId);

        if (existingPost) {
            return error('post-already-exists');
        }

        await this.postRepository.save(post);

        return ok(post);
    }

    async updateInteractionCounts(
        post: Post,
    ): Promise<Result<Post, UpdateInteractionCountsError>> {
        if (post.isInternal) {
            return error('post-is-internal');
        }

        const context = this.fedifyContextFactory.getFedifyContext();
        const documentLoader = await context.getDocumentLoader({
            identifier: 'index',
        });
        const object = await lookupObject(post.apId, { documentLoader });

        if (object === null) {
            return error('upstream-error');
        }

        if (!(object instanceof Note) && !(object instanceof Article)) {
            return error('not-a-post');
        }

        const likeCount = await getLikeCountFromRemote(object);
        const repostCount = await getRepostCountFromRemote(object);

        if (likeCount === null && repostCount === null) {
            return error(INTERACTION_COUNTS_NOT_FOUND);
        }

        const shouldUpdateLikeCount =
            likeCount !== null && likeCount !== post.likeCount;
        const shouldUpdateRepostCount =
            repostCount !== null && repostCount !== post.repostCount;

        if (!shouldUpdateLikeCount && !shouldUpdateRepostCount) {
            return ok(post);
        }

        if (shouldUpdateLikeCount) {
            post.setLikeCount(likeCount);
        }

        if (shouldUpdateRepostCount) {
            post.setRepostCount(repostCount);
        }

        await this.postRepository.save(post);
        return ok(post);
    }
}
