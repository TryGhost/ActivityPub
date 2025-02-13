import { Article, Note, lookupObject } from '@fedify/fedify';
import type { AccountService } from '../account/account.service';
import type { FedifyContextFactory } from '../activitypub/fedify-context.factory';
import { Audience, Post, PostType } from './post.entity';
import type { KnexPostRepository } from './post.repository.knex';

export class PostService {
    constructor(
        private readonly postRepository: KnexPostRepository,
        private readonly accountService: AccountService,
        private readonly fedifyContextFactory: FedifyContextFactory,
    ) {}

    async getByApId(id: URL): Promise<Post> {
        const post = await this.postRepository.getByApId(id);
        if (post) {
            return post;
        }

        const context = this.fedifyContextFactory.getFedifyContext();

        const documentLoader = await context.getDocumentLoader({
            handle: 'index',
        });
        const foundObject = await lookupObject(id, { documentLoader });

        if (!foundObject) {
            throw new Error('Could not find');
        }

        if (
            !(foundObject instanceof Note) &&
            !(foundObject instanceof Article)
        ) {
            throw new Error('Was not Note or Article');
        }

        const type =
            foundObject instanceof Note ? PostType.Note : PostType.Article;

        if (!foundObject.attributionId) {
            throw new Error('No author');
        }

        const author = await this.accountService.getByApId(
            foundObject.attributionId,
        );

        const newlyCreatedPost = new Post(
            null,
            null,
            author,
            type,
            Audience.Public,
            foundObject.name?.toString() || null,
            null,
            foundObject.content?.toString() || null,
            foundObject.url instanceof URL ? foundObject.url : id,
            foundObject.imageId,
            foundObject.published
                ? new Date(foundObject.published?.toString())
                : new Date(),
            0,
            0,
            0,
            null,
            null,
            null,
            id,
        );

        await this.postRepository.save(newlyCreatedPost);

        return newlyCreatedPost;
    }
}
