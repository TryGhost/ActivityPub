import {
    type Activity,
    type Actor,
    Article,
    Create,
    type Object as FedifyObject,
    Note,
    PUBLIC_COLLECTION,
} from '@fedify/fedify';
import type { Temporal } from '@js-temporal/polyfill';
import { v4 as uuidv4 } from 'uuid';

import type {
    ActivitySender,
    ActorResolver,
    ObjectStore,
    Outbox,
    UriBuilder,
} from '../activitypub';

/**
 * Post to be published to the Fediverse
 */
export interface Post {
    /**
     * Unique identifier of the post
     */
    id: string;
    /**
     * Title of the post
     */
    title: string;
    /**
     * Content of the post
     */
    content: string | null;
    /**
     * Excerpt of the post
     */
    excerpt: string | null;
    /**
     * URL to the post's feature image
     */
    featureImageUrl: URL | null;
    /**
     * Published date of the post
     */
    publishedAt: Temporal.Instant;
    /**
     * URL to the post
     */
    url: URL;
    /**
     * Information about the post's author
     */
    author: {
        /**
         * The author's Fediverse handle
         */
        handle: string;
    };
}

/**
 * Publishes content to the Fediverse
 */
export interface PublishingService {
    /**
     * Publishes a post to the Fediverse
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

        // Build the required objects
        const preview = new Note({
            id: this.uriBuilder.buildObjectUri(Note, post.id),
            content: post.excerpt,
        });
        const article = new Article({
            id: this.uriBuilder.buildObjectUri(Article, post.id),
            attribution: actor,
            name: post.title,
            content: post.content,
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
