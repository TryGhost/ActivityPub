import { type Actor, type Collection, isActor } from '@fedify/fedify';
import type { Account } from 'account/account.entity';
import { getAccountHandle } from 'account/utils';
import type { FedifyContextFactory } from 'activitypub/fedify-context.factory';
import { getHandle } from 'helpers/activitypub/actor';
import { sanitizeHtml } from 'helpers/html';
import type { Knex } from 'knex';
import { lookupAPIdByHandle, lookupObject } from 'lookup-helpers';
import type { AccountDTO } from '../types';

/**
 * Additional context that can be passed to the view
 */
interface ViewContext {
    requestUserAccount?: Account;
}

export class AccountView {
    constructor(
        private readonly db: Knex,
        private readonly fedifyContextFactory: FedifyContextFactory,
    ) {}

    /**
     * View an account by ID
     *
     * This will only return internal accounts, not external accounts
     *
     * @param id Account ID
     */
    async viewById(id: number): Promise<AccountDTO | null> {
        const accountData = await this.db('accounts')
            .innerJoin('users', 'users.account_id', 'accounts.id')
            .where('accounts.id', id)
            .select(
                'accounts.*',
                this.db.raw(
                    '(select count(*) from posts where posts.author_id = accounts.id) as post_count',
                ),
                this.db.raw(
                    '(select count(*) from likes where likes.account_id = accounts.id) as like_count',
                ),
                this.db.raw(
                    '(select count(*) from reposts where reposts.account_id = accounts.id) as repost_count',
                ),
                this.db.raw(
                    '(select count(*) from follows where follows.follower_id = accounts.id) as following_count',
                ),
                this.db.raw(
                    '(select count(*) from follows where follows.following_id = accounts.id) as follower_count',
                ),
            )
            .first();

        if (!accountData) {
            return null;
        }

        return {
            id: accountData.id,
            name: accountData.name,
            handle: getAccountHandle(
                new URL(accountData.ap_id).host,
                accountData.username,
            ),
            bio: sanitizeHtml(accountData.bio || ''),
            url: accountData.url,
            avatarUrl: accountData.avatar_url || '',
            bannerImageUrl: accountData.banner_image_url || '',
            customFields: {},
            postCount: accountData.post_count,
            likedCount: accountData.like_count,
            followingCount: accountData.following_count,
            followerCount: accountData.follower_count,
            followedByMe: false,
            followsMe: false,
            attachment: [],
        };
    }

    /**
     * View an account by its handle
     *
     * This will attempt to resolve an internal account, and if the internal
     * account is not found, it will attempt to resolve the account via the
     * Fediverse
     *
     * @param handle Handle
     * @param context View context
     */
    async viewByHandle(
        handle: string,
        context: ViewContext,
    ): Promise<AccountDTO | null> {
        const ctx = this.fedifyContextFactory.getFedifyContext();

        const apId = await lookupAPIdByHandle(ctx, handle);

        if (!apId) {
            return null;
        }

        return this.viewByApId(apId, context);
    }

    /**
     * View an account by its AP ID
     *
     * This will attempt to resolve an internal account, and if the internal
     * account is not found, it will attempt to resolve the account via the
     * Fediverse
     *
     * @param apId AP ID
     * @param context View context
     */
    async viewByApId(
        apId: string,
        context: ViewContext,
    ): Promise<AccountDTO | null> {
        const accountData = await this.db('accounts')
            // Inner join onto the users table to ensure we only look up internal
            // accounts in the database. For external accounts, we will look up
            // the account via the Fediverse
            .innerJoin('users', 'users.account_id', 'accounts.id')
            .where('accounts.ap_id', apId)
            .select(
                'accounts.*',
                this.db.raw(
                    '(select count(*) from posts where posts.author_id = accounts.id) as post_count',
                ),
                this.db.raw(
                    '(select count(*) from likes where likes.account_id = accounts.id) as like_count',
                ),
                this.db.raw(
                    '(select count(*) from reposts where reposts.account_id = accounts.id) as repost_count',
                ),
                this.db.raw(
                    '(select count(*) from follows where follows.follower_id = accounts.id) as following_count',
                ),
                this.db.raw(
                    '(select count(*) from follows where follows.following_id = accounts.id) as follower_count',
                ),
            )
            .first();

        if (!accountData) {
            return this.viewByApIdRemote(apId, context);
        }

        let followedByMe = false;
        let followsMe = false;

        if (context.requestUserAccount?.id) {
            followedByMe =
                (
                    await this.db('follows')
                        .where('follower_id', context.requestUserAccount.id)
                        .where('following_id', accountData.id)
                        .first()
                )?.id !== undefined;

            followsMe =
                (
                    await this.db('follows')
                        .where('follower_id', accountData.id)
                        .where('following_id', context.requestUserAccount.id)
                        .first()
                )?.id !== undefined;
        }

        return {
            id: accountData.id,
            name: accountData.name,
            handle: getAccountHandle(
                new URL(accountData.ap_id).host,
                accountData.username,
            ),
            bio: sanitizeHtml(accountData.bio || ''),
            url: accountData.url,
            avatarUrl: accountData.avatar_url || '',
            bannerImageUrl: accountData.banner_image_url || '',
            customFields: {},
            postCount: accountData.post_count,
            likedCount: accountData.like_count,
            followingCount: accountData.following_count,
            followerCount: accountData.follower_count,
            followedByMe,
            followsMe,
            attachment: [],
        };
    }

    /**
     * View an account by its AP ID
     *
     * This will attempt to resolve the account via the Fediverse
     *
     * @param apId AP ID
     * @param context View context
     */
    private async viewByApIdRemote(
        apId: string,
        context: ViewContext,
    ): Promise<AccountDTO | null> {
        const fedifyContext = this.fedifyContextFactory.getFedifyContext();

        const actor = await lookupObject(fedifyContext, apId);

        if (actor === null) {
            throw new Error(`Could not find Actor ${apId}`);
        }

        if (!isActor(actor)) {
            return null;
        }

        let followedByMe = false;
        let followsMe = false;

        if (context.requestUserAccount?.id) {
            const externalAccount = await this.db('accounts')
                .where('ap_id', apId)
                .first();

            if (externalAccount) {
                followedByMe =
                    (
                        await this.db('follows')
                            .where('follower_id', context.requestUserAccount.id)
                            .where('following_id', externalAccount.id)
                            .first()
                    )?.id !== undefined;

                followsMe =
                    (
                        await this.db('follows')
                            .where('follower_id', externalAccount.id)
                            .where(
                                'following_id',
                                context.requestUserAccount.id,
                            )
                            .first()
                    )?.id !== undefined;
            }
        }

        const icon = await actor.getIcon();
        const image = await actor.getImage();

        const [postCount, likedPostCount, followerCount, followingCount] =
            await Promise.all([
                this.getActorCollectionCount(actor, 'outbox'),
                this.getActorCollectionCount(actor, 'liked'),
                this.getActorCollectionCount(actor, 'followers'),
                this.getActorCollectionCount(actor, 'following'),
            ]);

        return {
            id: actor.id?.toString() || '',
            name: actor.name?.toString() || '',
            handle: getHandle(actor),
            bio: sanitizeHtml(actor.summary?.toString() || ''),
            url: actor.url?.toString() || '',
            avatarUrl: icon?.url?.toString() || '',
            bannerImageUrl: image?.url?.toString() || '',
            customFields: {},
            postCount: postCount,
            likedCount: likedPostCount,
            followingCount: followingCount,
            followerCount: followerCount,
            followedByMe,
            followsMe,
            attachment: [],
        };
    }

    /**
     * Get the count of a collection for an actor
     *
     * @param actor Actor instance
     * @param collection Collection name
     */
    private async getActorCollectionCount(
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
            const collection = await getCollection.bind(actor)();

            return collection?.totalItems ?? 0;
        } catch (error) {
            return 0;
        }
    }
}
