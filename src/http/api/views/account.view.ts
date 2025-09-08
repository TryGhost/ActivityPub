import { type Actor, type Collection, isActor } from '@fedify/fedify';
import type { Knex } from 'knex';

import type { Account } from '@/account/account.entity';
import { getAccountHandle } from '@/account/utils';
import type { FedifyContextFactory } from '@/activitypub/fedify-context.factory';
import { getError, getValue, isError } from '@/core/result';
import { getAttachments, getHandle } from '@/helpers/activitypub/actor';
import { sanitizeHtml } from '@/helpers/html';
import type { AccountDTO, AccountDTOWithBluesky } from '@/http/api/types';
import { lookupActorProfile, lookupObject } from '@/lookup-helpers';

/**
 * Additional context that can be passed to the view
 */
interface ViewContext {
    /**
     * The account associated with the user making the request
     */
    requestUserAccount?: Account;
}

export class AccountView {
    constructor(
        private readonly db: Knex,
        private readonly fedifyContextFactory: FedifyContextFactory,
    ) {}

    /**
     * View an internal account by its ID
     */
    async viewById(
        id: number,
        context: ViewContext = {},
    ): Promise<AccountDTO | AccountDTOWithBluesky | null> {
        const accountData = await this.getAccountByQuery(
            (qb: Knex.QueryBuilder) => qb.where('accounts.id', id),
        );

        if (!accountData) {
            return null;
        }

        let followedByMe = false;
        let followsMe = false;
        let blockedByMe = false;
        let domainBlockedByMe = false;

        if (
            context.requestUserAccount?.id &&
            // Don't check if the request user is following / followed / blocking themselves
            accountData.id !== context.requestUserAccount.id
        ) {
            ({ followedByMe, followsMe, blockedByMe, domainBlockedByMe } =
                await this.getRequestUserContextData(
                    context.requestUserAccount.id,
                    accountData.id,
                    new URL(accountData.ap_id).hostname,
                ));
        }

        // If the request user is requesting their own account, include
        // Bluesky integration data
        const shouldIncludeBlueskyIntegrationData =
            context.requestUserAccount?.id &&
            accountData.id === context.requestUserAccount.id;

        let blueskyEnabled: boolean = false;
        let blueskyHandle: string | null = null;

        if (shouldIncludeBlueskyIntegrationData) {
            ({ blueskyEnabled, blueskyHandle } =
                await this.getBlueskyIntegrationData(accountData.id));
        }

        return {
            id: accountData.id,
            apId: accountData.ap_id,
            name: accountData.name,
            handle: getAccountHandle(
                new URL(accountData.ap_id).host,
                accountData.username,
            ),
            bio: sanitizeHtml(accountData.bio || ''),
            url: accountData.url,
            avatarUrl: accountData.avatar_url || '',
            bannerImageUrl: accountData.banner_image_url || '',
            customFields: accountData.custom_fields || {},
            postCount: accountData.post_count + accountData.repost_count,
            likedCount: accountData.like_count,
            followingCount: accountData.following_count,
            followerCount: accountData.follower_count,
            followedByMe,
            followsMe,
            blockedByMe,
            domainBlockedByMe,
            ...(shouldIncludeBlueskyIntegrationData
                ? {
                      blueskyEnabled,
                      blueskyHandle,
                  }
                : {}),
        };
    }

    /**
     * View an account by its handle
     *
     * This will attempt to resolve an internal account, and if the internal
     * account is not found, it will attempt to resolve the account via the
     * Fediverse
     */
    async viewByHandle(
        handle: string,
        context: ViewContext = {},
    ): Promise<AccountDTO | null> {
        const ctx = this.fedifyContextFactory.getFedifyContext();

        const lookupResult = await lookupActorProfile(ctx, handle);

        if (isError(lookupResult)) {
            ctx.data.logger.error(
                `Failed to lookup apId for handle: ${handle}, error: ${getError(lookupResult)}`,
            );
            return null;
        }

        const apId = getValue(lookupResult);

        return this.viewByApId(apId.href, context);
    }

    /**
     * View an account by its AP ID
     *
     * This will attempt to resolve an internal account, and if the internal
     * account is not found, it will attempt to resolve the account via the
     * Fediverse
     */
    async viewByApId(
        apId: string,
        context: ViewContext = {},
    ): Promise<AccountDTO | null> {
        const accountData = await this.getAccountByQuery(
            (qb: Knex.QueryBuilder) =>
                qb.whereRaw('ap_id_hash = UNHEX(SHA2(?, 256))', [apId]),
        );

        if (!accountData) {
            return this.viewByApIdRemote(apId, context);
        }

        let followedByMe = false;
        let followsMe = false;
        let blockedByMe = false;
        let domainBlockedByMe = false;

        if (
            context.requestUserAccount?.id &&
            // Don't check if the request user is following / followed / blocking themselves
            accountData.id !== context.requestUserAccount.id
        ) {
            ({ followedByMe, followsMe, blockedByMe, domainBlockedByMe } =
                await this.getRequestUserContextData(
                    context.requestUserAccount.id,
                    accountData.id,
                    new URL(accountData.ap_id).hostname,
                ));
        }

        return {
            id: accountData.id,
            apId: accountData.ap_id,
            name: accountData.name,
            handle: getAccountHandle(
                new URL(accountData.ap_id).host,
                accountData.username,
            ),
            bio: sanitizeHtml(accountData.bio || ''),
            url: accountData.url,
            avatarUrl: accountData.avatar_url || '',
            bannerImageUrl: accountData.banner_image_url || '',
            customFields: accountData.custom_fields || {},
            postCount: accountData.post_count + accountData.repost_count,
            likedCount: accountData.like_count,
            followingCount: accountData.following_count,
            followerCount: accountData.follower_count,
            followedByMe,
            followsMe,
            blockedByMe,
            domainBlockedByMe,
        };
    }

    /**
     * View an account by its AP ID by attempting to resolve the account
     * via the Fediverse
     */
    private async viewByApIdRemote(
        apId: string,
        context: ViewContext = {},
    ): Promise<AccountDTO | null> {
        const fedifyContext = this.fedifyContextFactory.getFedifyContext();

        const actor = await lookupObject(fedifyContext, apId);

        if (actor === null) {
            return null;
        }

        if (!isActor(actor)) {
            return null;
        }

        let followedByMe = false;
        let followsMe = false;
        let blockedByMe = false;
        let domainBlockedByMe = false;

        if (context.requestUserAccount?.id) {
            const externalAccount = await this.db('accounts')
                .whereRaw('ap_id_hash = UNHEX(SHA2(?, 256))', [apId])
                .select('id', 'ap_id')
                .first();

            if (externalAccount) {
                ({ followedByMe, followsMe, blockedByMe, domainBlockedByMe } =
                    await this.getRequestUserContextData(
                        context.requestUserAccount.id,
                        externalAccount.id,
                        new URL(externalAccount.ap_id).hostname,
                    ));
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
            apId: actor.id?.toString() || '',
            name: actor.name?.toString() || '',
            handle: getHandle(actor),
            bio: sanitizeHtml(actor.summary?.toString() || ''),
            url: actor.url?.toString() || '',
            avatarUrl: icon?.url?.toString() || '',
            bannerImageUrl: image?.url?.toString() || '',
            customFields: await (async () => {
                const attachments = await getAttachments(actor, {
                    sanitizeValue: (value: string) => sanitizeHtml(value),
                });
                return attachments.reduce(
                    (acc: { [key: string]: string }, attachment) => {
                        acc[attachment.name] = attachment.value;
                        return acc;
                    },
                    {},
                );
            })(),
            postCount: postCount,
            likedCount: likedPostCount,
            followingCount: followingCount,
            followerCount: followerCount,
            followedByMe,
            followsMe,
            blockedByMe,
            domainBlockedByMe,
        };
    }

    private async getAccountByQuery(query: Knex.QueryCallback) {
        return (
            this.db('accounts')
                // Join the users table to ensure we are getting an internal account
                .innerJoin('users', 'users.account_id', 'accounts.id')
                .select(
                    'accounts.id',
                    'accounts.username',
                    'accounts.name',
                    'accounts.bio',
                    'accounts.avatar_url',
                    'accounts.banner_image_url',
                    'accounts.url',
                    'accounts.custom_fields',
                    'accounts.ap_id',
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
                .where(query)
                .first()
        );
    }

    private async getRequestUserContextData(
        requestUserAccountId: number,
        retrievedAccountId: number,
        retrievedAccountDomain: string,
    ) {
        let followedByMe = false;
        let followsMe = false;
        let blockedByMe = false;
        let domainBlockedByMe = false;

        followedByMe =
            (
                await this.db('follows')
                    .where('follower_id', requestUserAccountId)
                    .where('following_id', retrievedAccountId)
                    .first()
            )?.id !== undefined;

        followsMe =
            (
                await this.db('follows')
                    .where('following_id', requestUserAccountId)
                    .where('follower_id', retrievedAccountId)
                    .first()
            )?.id !== undefined;

        blockedByMe =
            (
                await this.db('blocks')
                    .where('blocker_id', requestUserAccountId)
                    .where('blocked_id', retrievedAccountId)
                    .first()
            )?.id !== undefined;

        domainBlockedByMe =
            (
                await this.db('domain_blocks')
                    .where('blocker_id', requestUserAccountId)
                    .where('domain', retrievedAccountDomain)
                    .first()
            )?.id !== undefined;

        return {
            followedByMe,
            followsMe,
            blockedByMe,
            domainBlockedByMe,
        };
    }

    private async getBlueskyIntegrationData(requestUserAccountId: number) {
        const blueskyHandle = await this.db(
            'bluesky_integration_account_handles',
        )
            .where('account_id', requestUserAccountId)
            .first()
            .then((row) => row?.handle);

        return {
            blueskyEnabled: !!blueskyHandle,
            blueskyHandle: blueskyHandle || null,
        };
    }

    private async getActorCollectionCount(
        actor: Actor,
        collectionName: 'outbox' | 'liked' | 'followers' | 'following',
    ): Promise<number> {
        let getCollection: () => Promise<Collection | null>;

        switch (collectionName) {
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
        } catch (_error) {
            return 0;
        }
    }
}
