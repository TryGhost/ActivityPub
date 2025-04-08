import {
    type Actor,
    type Collection,
    isActor,
    lookupObject,
} from '@fedify/fedify';
import type { FedifyContextFactory } from 'activitypub/fedify-context.factory';
import { Account } from './account.entity';

async function getCollectionCount(
    actor: Actor,
    collection: 'outbox' | 'liked' | 'followers' | 'following',
): Promise<number> {
    let getCollection: () => Promise<Collection | null>;

    switch (collection) {
        case 'outbox':
            getCollection = actor.getOutbox;
            break;
        case 'liked':
            getCollection = actor.getLiked;
            break;
        case 'followers':
            getCollection = actor.getFollowers;
            break;
        case 'following':
            getCollection = actor.getFollowing;
            break;
    }

    try {
        const collection = await getCollection();

        return collection?.totalItems ?? 0;
    } catch (error) {
        return 0;
    }
}

export class RemoteAccountRepository {
    constructor(private readonly fedifyContextFactory: FedifyContextFactory) {}

    async getByApId(id: URL): Promise<Account | null> {
        const context = this.fedifyContextFactory.getFedifyContext();

        const documentLoader = await context.getDocumentLoader({
            handle: 'index',
        });

        const actor = await lookupObject(id, { documentLoader });

        if (actor === null) {
            throw new Error(`Could not find Actor ${id}`);
        }

        if (!isActor(actor)) {
            return null;
        }

        const icon = await actor.getIcon();
        const image = await actor.getImage();

        const [postCount, likedPostCount, followerCount, followingCount] =
            await Promise.all([
                getCollectionCount(actor, 'outbox'),
                getCollectionCount(actor, 'liked'),
                getCollectionCount(actor, 'followers'),
                getCollectionCount(actor, 'following'),
            ]);

        return new Account(
            null,
            null,
            actor.preferredUsername?.toString() ?? '',
            actor.name?.toString() ?? null,
            actor.summary?.toString() ?? null,
            icon?.url?.href ? new URL(icon.url.href) : null,
            image?.url?.href ? new URL(image.url.href) : null,
            null,
            actor.id ?? null,
            actor.url?.href ? new URL(actor.url.href) : null,
            actor.followersId,
            postCount,
            0, // We cannot get the repost count from the actor
            likedPostCount,
            followerCount,
            followingCount,
        );
    }
}
