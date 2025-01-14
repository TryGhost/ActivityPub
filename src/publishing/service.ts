import {
    type Activity,
    type Actor,
    Article,
    Create,
    type Object as FedifyObject,
    Note,
    PUBLIC_COLLECTION,
} from '@fedify/fedify';
import type { Logger } from '@logtape/logtape';
import { v4 as uuidv4 } from 'uuid';

import type {
    ActivitySender,
    ActorResolver,
    ObjectStore,
    Outbox,
    UriBuilder,
} from '../activitypub';
import { type Post, PostVisibility } from './types';

/**
 * Marker to indicate that proceeding content is not public
 */
export const POST_CONTENT_NON_PUBLIC_MARKER = '<!--members-only-->';

/**
 * Publishes content to the Fediverse
 */
export interface PublishingService {
    /**
     * Publish a post to the Fediverse
     *
     * @param post Post to publish
     * @param outbox Outbox to record the published post in
     */
    publishPost(post: Post, outbox: Outbox<unknown>): Promise<void>;
}

/**
 * PublishingService implementation using Fedify
 */
export class FedifyPublishingService implements PublishingService {
    constructor(
        private readonly activitySender: ActivitySender<Activity, Actor>,
        private readonly actorResolver: ActorResolver<Actor>,
        private readonly logger: Logger,
        private readonly objectStore: ObjectStore<FedifyObject>,
        private readonly uriBuilder: UriBuilder<FedifyObject>,
    ) {}

    async publishPost(post: Post, outbox: Outbox<Activity>) {
        // @TODO: Should this be a transaction and all operations rolled back if
        // one fails?

        // Resolve the actor responsible for publishing the post
        const actor = await this.actorResolver.resolveActorByHandle(
            post.author.handle,
        );

        if (!actor) {
            throw new Error(
                `Actor not resolved for handle: ${post.author.handle}`,
            );
        }

        // Compute the content to use for the article
        const isPublic = post.visibility === PostVisibility.Public;
        let articleContent = post.content;

        if (isPublic === false && post.content !== null) {
            articleContent = '';

            const nonPublicContentIdx = post.content.indexOf(
                POST_CONTENT_NON_PUBLIC_MARKER,
            );
            if (nonPublicContentIdx !== -1) {
                articleContent = post.content.substring(0, nonPublicContentIdx);
            }

            // If there is no public content, do not publish the post
            if (articleContent === '') {
                this.logger.info(
                    'Skipping publishing post: No public content found for post: {post}',
                    {
                        post,
                    },
                );

                return;
            }
        }

        // Build the required objects
        const preview = new Note({
            id: this.uriBuilder.buildObjectUri(Note, post.id),
            content: post.excerpt,
        });
        const article = new Article({
            id: this.uriBuilder.buildObjectUri(Article, post.id),
            attribution: actor,
            name: post.title,
            content: articleContent,
            image: post.featureImageUrl,
            published: post.publishedAt,
            preview,
            url: post.url,
            to: PUBLIC_COLLECTION,
            cc: this.uriBuilder.buildFollowersCollectionUri(post.author.handle),
        });
        const create = new Create({
            actor,
            object: article,
            id: this.uriBuilder.buildObjectUri(Create, uuidv4()),
            to: PUBLIC_COLLECTION,
            cc: this.uriBuilder.buildFollowersCollectionUri(post.author.handle),
        });

        // Store the built objects
        await this.objectStore.store(preview);
        await this.objectStore.store(article);
        await this.objectStore.store(create);

        // Add the activity to the provided outbox
        await outbox.add(create);

        // Send the create activity to the followers of the actor
        await this.activitySender.sendActivityToActorFollowers(create, actor);
    }
}
