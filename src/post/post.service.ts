import {
    Article,
    Mention as FedifyMention,
    lookupObject,
    Note,
} from '@fedify/fedify';
import type { Logger } from '@logtape/logtape';

import type { Account } from '@/account/account.entity';
import type { AccountService } from '@/account/account.service';
import type { FedifyContextFactory } from '@/activitypub/fedify-context.factory';
import {
    error,
    exhaustiveCheck,
    getError,
    getValue,
    isError,
    ok,
    type Result,
} from '@/core/result';
import { parseURL } from '@/core/url';
import {
    getLikeCountFromRemote,
    getRepostCountFromRemote,
    lookupActorProfile,
} from '@/lookup-helpers';
import type { ModerationService } from '@/moderation/moderation.service';
import { ContentPreparer } from '@/post/content';
import {
    type ImageAttachment,
    type Mention,
    Post,
    type PostAttachment,
    PostType,
    type PostUpdateParams,
} from '@/post/post.entity';
import type { KnexPostRepository, Outbox } from '@/post/post.repository.knex';
import type { VerificationError } from '@/storage/adapters/storage-adapter';
import type { ImageStorageService } from '@/storage/image-storage.service';

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

export type DeletePostError = GetByApIdError | 'not-author';

export type UpdatePostError = 'post-not-found' | 'not-author';

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
        private readonly imageStorageService: ImageStorageService,
        private readonly moderationService: ModerationService,
        private readonly logger: Logger,
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
                    const attachmentJson = await a.toJsonLd();
                    let url: URL | null;
                    let mediaType: string | null;
                    if (Array.isArray(attachmentJson.url)) {
                        if (attachmentJson.url.length === 0) {
                            // no usable URL – skip this attachment
                            continue;
                        }
                        // attachments can have multiple urls, we need to handle this. For now we are using the first one.
                        url = parseURL(attachmentJson.url[0].href);
                        mediaType = attachmentJson.url[0].mediaType;
                    } else {
                        url = parseURL(attachmentJson.url);
                        mediaType = attachmentJson.mediaType;
                    }
                    if (!url) {
                        this.logger.error(
                            `Failed to parse URL for attachment for post ${foundObject.id}`,
                        );
                        continue;
                    }
                    postAttachments.push({
                        type: attachmentJson.type,
                        mediaType,
                        name: attachmentJson.name,
                        url,
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

    /**
     * Get a post by its ActivityPub ID.
     * TODO: Update to use error objects instead of string literals - @see ADR-0005
     */
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
        image?: ImageAttachment,
    ): Promise<Result<Post, VerificationError>> {
        if (image) {
            const result = await this.imageStorageService.verifyFileUrl(
                image.url,
            );
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
        image?: ImageAttachment,
    ): Promise<
        Result<Post, VerificationError | GetByApIdError | InteractionError>
    > {
        if (image) {
            const result = await this.imageStorageService.verifyFileUrl(
                image.url,
            );
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

    async getOutboxForAccount(
        accountId: number,
        cursor: string | null,
        pageSize: number,
    ): Promise<Outbox> {
        return this.postRepository.getOutboxForAccount(
            accountId,
            cursor,
            pageSize,
        );
    }

    async getOutboxItemCount(accountId: number): Promise<number> {
        return this.postRepository.getOutboxItemCount(accountId);
    }

    async deleteByApId(
        apId: URL,
        account: Account,
    ): Promise<Result<boolean, DeletePostError>> {
        const postResult = await this.getByApId(apId);
        if (isError(postResult)) {
            return postResult;
        }
        const post = getValue(postResult);
        if (post.author.uuid !== account.uuid) {
            return error('not-author');
        }
        post.delete(account);
        await this.postRepository.save(post);
        return ok(true);
    }

    async updateByApId(
        apId: URL,
        account: Account,
        params: PostUpdateParams,
    ): Promise<Result<Post, UpdatePostError>> {
        const post = await this.postRepository.getByApId(apId);
        if (post === null) {
            return error('post-not-found');
        }
        if (post.author.uuid !== account.uuid) {
            return error('not-author');
        }
        if (
            post.title !== params.title ||
            post.content !== params.content ||
            post.excerpt !== params.excerpt ||
            post.summary !== params.summary ||
            post.imageUrl?.href !== params.imageUrl?.href ||
            post.url.href !== params.url.href ||
            JSON.stringify(post.metadata) !== JSON.stringify(params.metadata)
        ) {
            post.update(account, params);
            await this.postRepository.save(post);
        }

        return ok(post);
    }
}
