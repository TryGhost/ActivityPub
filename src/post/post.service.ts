import { Article, Note, lookupObject } from '@fedify/fedify';
import type { AccountService } from '../account/account.service';
import type { FedifyContextFactory } from '../activitypub/fedify-context.factory';
import { Post, type PostAttachment, PostType } from './post.entity';
import type { KnexPostRepository } from './post.repository.knex';

export class PostService {
    constructor(
        private readonly postRepository: KnexPostRepository,
        private readonly accountService: AccountService,
        private readonly fedifyContextFactory: FedifyContextFactory,
    ) {}

    /**
     * Get the attachments for a post
     *
     * @param attachments
     */
    private async getPostAttachments(
        foundObject: Note | Article,
    ): Promise<PostAttachment[] | null> {
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
        if (!postAttachments.length) {
            return null;
        }
        return postAttachments;
    }

    async getByApId(id: URL): Promise<Post | null> {
        const post = await this.postRepository.getByApId(id);
        if (post) {
            return post;
        }

        const context = this.fedifyContextFactory.getFedifyContext();

        const documentLoader = await context.getDocumentLoader({
            handle: 'index',
        });
        const foundObject = await lookupObject(id, { documentLoader });

        // If foundObject is null - we could not find anything for this URL
        // Error because could be upstream server issues and we want a retry
        if (foundObject === null) {
            throw new Error(`Could not find Object ${id}`);
        }

        // If we do find an Object, and it's not a Note or Article
        // we return null because we're unable to handle it.
        if (
            !(foundObject instanceof Note) &&
            !(foundObject instanceof Article)
        ) {
            return null;
        }

        const type =
            foundObject instanceof Note ? PostType.Note : PostType.Article;

        // We're also unable to handle objects without an author
        if (!foundObject.attributionId) {
            return null;
        }

        const author = await this.accountService.getByApId(
            foundObject.attributionId,
        );

        if (author === null) {
            return null;
        }

        let inReplyTo = null;
        if (foundObject.replyTargetId) {
            inReplyTo = await this.getByApId(foundObject.replyTargetId);
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

        return newlyCreatedPost;
    }
}
