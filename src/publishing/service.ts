import {
    type Activity,
    type Actor,
    Article,
    Create,
    Note as FedifyNote,
    type Object as FedifyObject,
    PUBLIC_COLLECTION,
} from '@fedify/fedify';
import { Temporal } from '@js-temporal/polyfill';
import { v4 as uuidv4 } from 'uuid';

import type {
    ActivitySender,
    ActorResolver,
    ObjectStore,
    Outbox,
    UriBuilder,
} from '../activitypub';
import type { Note, Post } from './types';

/**
 * Type alias for the returned activity JSON-LD
 */
export type ActivityJsonLd = unknown;

/**
 * Publishes content to the Fediverse
 */
export interface PublishingService {
    /**
     * Publish a post to the Fediverse
     *
     * @param post Post to publish
     * @param outbox Outbox to record the published post in
     * @returns The activity in JSON-LD format
     */
    publishPost(post: Post, outbox: Outbox<unknown>): Promise<ActivityJsonLd>;

    /**
     * Publish a note to the Fediverse
     *
     * @param note Note to publish
     * @param outbox Outbox to record the published note in
     * @returns The activity in JSON-LD format
     */
    publishNote(note: Note, outbox: Outbox<unknown>): Promise<ActivityJsonLd>;
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
        const preview = new FedifyNote({
            id: this.uriBuilder.buildObjectUri(FedifyNote, post.id),
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

        // Return activity JSON-LD
        return await create.toJsonLd();
    }

    async publishNote(note: Note, outbox: Outbox<Activity>) {
        // @TODO: Should this be a transaction and all operations rolled back if
        // one fails?

        // Resolve the actor responsible for publishing the post
        const actor = await this.actorResolver.resolveActorByHandle(
            note.author.handle,
        );

        if (!actor) {
            throw new Error(
                `Actor not resolved for handle: ${note.author.handle}`,
            );
        }

        // Build the required objects
        const to = PUBLIC_COLLECTION;
        const cc = [
            this.uriBuilder.buildFollowersCollectionUri(note.author.handle),
        ];

        const fedifyNote = new FedifyNote({
            id:
                note.apId ||
                this.uriBuilder.buildObjectUri(FedifyNote, uuidv4()),
            attribution: actor,
            content: note.content,
            summary: null,
            published: Temporal.Now.instant(),
            to: to,
            ccs: cc,
        });
        const create = new Create({
            id: this.uriBuilder.buildObjectUri(Create, uuidv4()),
            actor: actor,
            object: fedifyNote,
            to: to,
            ccs: cc,
        });

        // Store the built objects
        await this.objectStore.store(fedifyNote);
        await this.objectStore.store(create);

        // Add the activity to the provided outbox
        await outbox.add(create);

        // Send the create activity to the followers of the actor
        await this.activitySender.sendActivityToActorFollowers(create, actor);

        // Return activity JSON-LD
        return await create.toJsonLd();
    }
}
