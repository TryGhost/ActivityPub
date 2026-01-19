import { randomUUID } from 'node:crypto';

import {
    type Actor,
    exportJwk,
    generateCryptoKeyPair,
    isActor,
    lookupObject,
} from '@fedify/fedify';
import type { Knex } from 'knex';

import { type Account, AccountEntity } from '@/account/account.entity';
import type { KnexAccountRepository } from '@/account/account.repository.knex';
import { AccountFollowedEvent } from '@/account/events/account-followed.event';
import type {
    Account as AccountType,
    ExternalAccountData,
    InternalAccountData,
    Site,
} from '@/account/types';
import { mapActorToExternalAccountData } from '@/account/utils';
import type { FedifyContextFactory } from '@/activitypub/fedify-context.factory';
import type { AsyncEvents } from '@/core/events';
import { error, getValue, isError, ok, type Result } from '@/core/result';
import { parseURL } from '@/core/url';

interface GetFollowingAccountsOptions {
    limit: number;
    offset: number;
    fields: (keyof AccountType)[];
}

interface GetFollowerAccountsOptions {
    limit: number;
    offset: number;
    fields: (keyof AccountType)[];
}

function isDuplicateEntryError(error: unknown): boolean {
    // Check for the specific MySQL error number for duplicate entries
    return (
        typeof error === 'object' &&
        error !== null &&
        'errno' in error &&
        error.errno === 1062
    );
}

type RemoteAccountFetchError =
    | 'invalid-type'
    | 'invalid-data'
    | 'network-failure'
    | 'not-found';

export const DELIVERY_FAILURE_BACKOFF_SECONDS = 60;
export const DELIVERY_FAILURE_BACKOFF_MULTIPLIER = 2;

export class AccountService {
    /**
     * @param db Database client
     */
    constructor(
        private readonly db: Knex,
        private readonly events: AsyncEvents,
        private readonly accountRepository: KnexAccountRepository,
        private readonly fedifyContextFactory: FedifyContextFactory,
        private readonly generateKeyPair: () => Promise<CryptoKeyPair> = generateCryptoKeyPair,
    ) {}

    /**
     * @deprecated use `ensureByApId`
     * Get an Account by the ActivityPub ID
     * If it is not found locally in our database it will be
     * remotely fetched and stored
     */
    async getByApId(id: URL): Promise<Account | null> {
        const account = await this.accountRepository.getByApId(id);
        if (account) {
            return account;
        }

        const context = this.fedifyContextFactory.getFedifyContext();

        const documentLoader = await context.getDocumentLoader({
            handle: 'index',
        });
        const potentialActor = await lookupObject(id, { documentLoader });

        // If potentialActor is null - we could not find anything for this URL
        // Error because could be upstream server issues and we want a retry
        if (potentialActor === null) {
            throw new Error(`Could not find Actor ${id}`);
        }

        // If we do find an Object, and it's not an Actor - we return null because
        // it's invalid, we don't expect this to be a temporary error
        if (!isActor(potentialActor)) {
            return null;
        }

        const data = await mapActorToExternalAccountData(potentialActor);

        await this.createExternalAccount(data);

        return this.accountRepository.getByApId(id);
    }

    async ensureByApId(
        id: URL,
    ): Promise<Result<Account, RemoteAccountFetchError>> {
        const account = await this.accountRepository.getByApId(id);
        if (account) {
            return ok(account);
        }

        const context = this.fedifyContextFactory.getFedifyContext();

        const documentLoader = await context.getDocumentLoader({
            handle: 'index',
        });

        let actor: Actor;

        try {
            const potentialActor = await lookupObject(id, { documentLoader });

            if (potentialActor === null) {
                return error('not-found');
            }

            if (!isActor(potentialActor)) {
                return error('invalid-type');
            }

            actor = potentialActor;
        } catch (_err) {
            return error('network-failure');
        }

        // We need to check if the actor's id differs from the input id because:
        // The input id might be the URL of an account (e.g., in the case of mentions).
        // In this case, the lookup finds an actor, but the actual ActivityPub ID
        // for the account might be different from the input id. Searching by the correct apId before creating a new account.
        if (actor.id && actor.id.href !== id.href) {
            return this.ensureByApId(actor.id);
        }

        let data: ExternalAccountData;

        try {
            data = await mapActorToExternalAccountData(actor);
        } catch (_err) {
            return error('invalid-data');
        }

        await this.createExternalAccount(data);

        const createdAccount = await this.accountRepository.getByApId(id);

        if (!createdAccount) {
            throw new Error(
                `A newly created account was not found in the database for id: ${id}`,
            );
        }

        return ok(createdAccount);
    }

    /**
     * Create an internal account
     *
     * An internal account is an account that is linked to a user
     *
     * @param site Site that the account belongs to
     * @param username Username for the account
     */
    async createInternalAccount(
        site: Site,
        internalAccountData: InternalAccountData,
    ): Promise<AccountType> {
        const keyPair = await this.generateKeyPair();

        const normalizedHost = site.host.replace(/^www\./, '');

        const draft = AccountEntity.draft({
            isInternal: true,
            host: new URL(`https://${site.host}`),
            username: internalAccountData.username,
            name: internalAccountData.name || normalizedHost,
            bio: internalAccountData.bio || null,
            url: new URL(`https://${site.host}`),
            avatarUrl: parseURL(internalAccountData.avatar_url),
            bannerImageUrl: parseURL(internalAccountData.banner_image_url),
            customFields: null,
            apPublicKey: keyPair.publicKey,
            apPrivateKey: keyPair.privateKey,
        });

        try {
            const account = await this.accountRepository.create(draft);
            const returnVal = await this.getByInternalId(account.id);
            if (returnVal) {
                return returnVal;
            }

            throw new Error(`Account ${account.id} not found`);
        } catch (error) {
            if (!isDuplicateEntryError(error)) {
                throw error;
            }

            const existingAccount = await this.accountRepository.getByApId(
                draft.apId,
            );

            if (!existingAccount) {
                throw new Error(
                    `Got duplicate entry error for account but account ${draft.apId} not found`,
                );
            }

            if (existingAccount.isInternal) {
                const returnVal = await this.getByInternalId(
                    existingAccount.id,
                );
                if (returnVal) {
                    return returnVal;
                }
                throw new Error(
                    `Got duplicate entry for internal account but account ${existingAccount.id} not found`,
                );
            }

            const hasPrivateKey = !!(
                await this.db('accounts')
                    .select('ap_private_key')
                    .where({
                        id: existingAccount.id,
                    })
                    .first()
            )?.ap_private_key;

            if (!hasPrivateKey) {
                const newKeyPair = await this.generateKeyPair();
                await this.db('accounts')
                    .where({
                        id: existingAccount.id,
                    })
                    .update({
                        ap_public_key: JSON.stringify(
                            await exportJwk(newKeyPair.publicKey),
                        ),
                        ap_private_key: JSON.stringify(
                            await exportJwk(newKeyPair.privateKey),
                        ),
                    });
            }

            await this.db('users').insert({
                account_id: existingAccount.id,
                site_id: site.id,
            });

            const returnVal = await this.getByInternalId(existingAccount.id);

            if (returnVal) {
                return returnVal;
            }

            throw new Error(
                `Got duplicate entry error for external account but account ${existingAccount.id} not found`,
            );
        }
    }

    /**
     * Create an external account
     *
     * An external account is an account that is not linked to a user
     *
     * @param accountData Data for the external account
     */
    async createExternalAccount(
        accountData: ExternalAccountData,
    ): Promise<AccountType> {
        const dataToInsert = {
            ...accountData,
            uuid: randomUUID(),
            ap_private_key: null,
            domain: new URL(accountData.ap_id).host,
        };

        try {
            const [accountId] = await this.db('accounts').insert(dataToInsert);
            return {
                id: accountId,
                ...dataToInsert,
            };
        } catch (error) {
            if (isDuplicateEntryError(error)) {
                const existingAccount = await this.db('accounts')
                    .whereRaw('ap_id_hash = UNHEX(SHA2(?, 256))', [
                        accountData.ap_id,
                    ])
                    .first<AccountType>();

                if (!existingAccount) {
                    throw error;
                }
                return existingAccount;
            }
            throw error;
        }
    }

    /**
     * Record an account follow
     *
     * @param followee Account to follow
     * @param follower Following account
     *
     * @deprecated Use `followAccount` instead
     */
    async recordAccountFollow(
        followee: { id: Account['id'] },
        follower: { id: Account['id'] },
    ): Promise<void> {
        const [insertCount] = await this.db('follows')
            .insert({
                following_id: followee.id,
                follower_id: follower.id,
            })
            .onConflict(['following_id', 'follower_id'])
            .ignore();

        if (insertCount === 0) {
            return;
        }

        await this.events.emitAsync(
            AccountFollowedEvent.getName(),
            new AccountFollowedEvent(followee.id, follower.id),
        );
    }

    /**
     * Record an account unfollow
     *
     * @param following The account that is being unfollowed
     * @param follower The account that is a follower
     *
     * @deprecated Use `unfollowAccount` instead
     */
    async recordAccountUnfollow(
        following: { id: Account['id'] },
        follower: { id: Account['id'] },
    ): Promise<void> {
        await this.db('follows')
            .where({
                following_id: following.id,
                follower_id: follower.id,
            })
            .del();
    }

    /**
     * Get an account by it's ActivityPub ID
     *
     * @param apId ActivityPub ID
     */
    async getAccountByApId(apId: string): Promise<AccountType | null> {
        if (apId === '') {
            return null;
        }

        return await this.db('accounts')
            .whereRaw('ap_id_hash = UNHEX(SHA2(?, 256))', [apId])
            .first();
    }

    /**
     * Get the default account for a site
     *
     * @param site Site
     */
    async getDefaultAccountForSite(site: Site): Promise<AccountType> {
        const users = await this.db('users').where('site_id', site.id);

        if (users.length === 0) {
            throw new Error(`No user found for site: ${site.id}`);
        }

        if (users.length > 1) {
            throw new Error(`Multiple users found for site: ${site.id}`);
        }

        const user = users[0];

        // We can safely assume that there is an account for the user due to
        // the foreign key constraint on the users table
        const account = await this.db('accounts')
            .where('id', user.account_id)
            .first();

        if (!account) {
            throw new Error(`Default account not found for site ${site.id}`);
        }

        return account;
    }

    async getAccountForSite(site: Site): Promise<Account> {
        return this.accountRepository.getBySite(site);
    }

    /**
     * Get the accounts that the provided account is following
     *
     * The results are ordered in reverse chronological order
     *
     * @param account Account
     * @param options Options for the query
     */
    async getFollowingAccounts(
        account: { id: Account['id'] },
        options: GetFollowingAccountsOptions, // @TODO: Make this optional
    ): Promise<AccountType[]> {
        return await this.db('follows')
            .select(options.fields.map((field) => `accounts.${field}`))
            .where('follows.follower_id', account.id)
            .innerJoin('accounts', 'accounts.id', 'follows.following_id')
            .limit(options.limit)
            .offset(options.offset)
            // order by the date created at in descending order and then by the
            // account id in descending order to ensure the most recent follows
            // are returned first (i.e in case multiple follows were created at
            // the same time)
            // @TODO: Make this configurable via the options?
            .orderBy('follows.created_at', 'desc')
            .orderBy('accounts.id', 'desc');
    }

    /**
     * Get the number of accounts that the provided account is following
     *
     * @param accountId id of the account
     */
    async getFollowingAccountsCount(accountId: number | null): Promise<number> {
        if (!accountId) {
            return 0;
        }

        const result = await this.db('follows')
            .where('follower_id', accountId)
            .count('*', { as: 'count' });

        return Number(result[0].count);
    }

    /**
     * Get the number of posts liked by the account
     *
     * @param accountId id of the account
     */
    async getLikedCount(accountId: number | null): Promise<number> {
        if (!accountId) {
            return 0;
        }

        const result = await this.db('likes')
            .join('posts', 'likes.post_id', 'posts.id')
            .where('likes.account_id', accountId)
            .whereNull('posts.in_reply_to')
            .count('*', { as: 'count' });

        return Number(result[0].count);
    }

    /**
     * Get the number of posts created by the account
     *
     * @param accountId id of the account
     */
    async getPostCount(accountId: number | null): Promise<number> {
        if (!accountId) {
            return 0;
        }

        const posts = await this.db('posts')
            .where('author_id', accountId)
            .count('*', { as: 'count' });

        const reposts = await this.db('reposts')
            .where('account_id', accountId)
            .count('*', { as: 'count' });

        return Number(posts[0].count) + Number(reposts[0].count);
    }

    /**
     * Get the accounts that are following the provided account
     *
     * The results are ordered in reverse chronological order
     *
     * @param account Account
     * @param options Options for the query
     */
    /**
     * Get follower accounts for the provided account.
     * TODO: Move direct DB query to repository - @see ADR-0006
     */
    async getFollowerAccounts(
        account: { id: Account['id'] },
        options: GetFollowerAccountsOptions, // @TODO: Make this optional
    ): Promise<AccountType[]> {
        return await this.db('follows')
            .select(options.fields.map((field) => `accounts.${field}`))
            .where('follows.following_id', account.id)
            .innerJoin('accounts', 'accounts.id', 'follows.follower_id')
            .limit(options.limit)
            .offset(options.offset)
            // order by the date created at in descending order and then by the
            // account id in descending order to ensure the most recent follows
            // are returned first (i.e in case multiple follows were created at
            // the same time)
            // @TODO: Make this configurable via the options?
            .orderBy('follows.created_at', 'desc')
            .orderBy('accounts.id', 'desc');
    }

    /**
     * Get the number of accounts that are following the provided account
     *
     * @param accountId id of the account
     */
    async getFollowerAccountsCount(accountId: number | null): Promise<number> {
        if (!accountId) {
            return 0;
        }

        const result = await this.db('follows')
            .where('following_id', accountId)
            .count('*', { as: 'count' });

        return Number(result[0].count);
    }

    /**
     * Check if an account is following another account
     *
     * @param accountId id of the account to check
     * @param followeeAccountId: id of the followee account
     */
    async checkIfAccountIsFollowing(
        followerId: number | null,
        followingId: number | null,
    ): Promise<boolean> {
        if (!followerId || !followingId) {
            return false;
        }

        const result = await this.db('follows')
            .where('follower_id', followerId)
            .where('following_id', followingId)
            .select(1)
            .first();

        return result !== undefined;
    }

    async getByInternalId(id: number): Promise<AccountType | null> {
        const rows = await this.db('accounts').select('*').where({ id });

        if (!rows || !rows.length) {
            return null;
        }

        if (rows.length !== 1) {
            throw new Error(`Multiple accounts found for id ${id}`);
        }

        const row = rows[0];

        return {
            id: row.id,
            username: row.username,
            name: row.name,
            bio: row.bio,
            avatar_url: row.avatar_url,
            banner_image_url: row.banner_image_url,
            url: row.url,
            custom_fields: row.custom_fields,
            ap_id: row.ap_id,
            ap_inbox_url: row.ap_inbox_url,
            ap_shared_inbox_url: row.ap_shared_inbox_url,
            ap_outbox_url: row.ap_outbox_url,
            ap_following_url: row.ap_following_url,
            ap_followers_url: row.ap_followers_url,
            ap_liked_url: row.ap_liked_url,
            ap_public_key: row.ap_public_key,
            ap_private_key: row.ap_private_key,
        };
    }

    async updateAccount(
        account: AccountType,
        data: Omit<Partial<AccountType>, 'id'>,
    ): Promise<AccountType> {
        await this.db('accounts').update(data).where({ id: account.id });

        const newAccount = Object.assign({}, account, data);

        const internalAccount = account.ap_private_key !== null;

        if (!internalAccount) {
            return newAccount;
        }

        const avatarChanged = account.avatar_url !== data.avatar_url;
        const nameChanged = account.name !== data.name;
        const bioChanged = account.bio !== data.bio;

        if (avatarChanged || nameChanged || bioChanged) {
            await this.events.emitAsync('account.updated', newAccount);
        }

        return newAccount;
    }

    async updateAccountProfile(
        account: Account,
        data: {
            name: string;
            bio: string;
            username: string;
            avatarUrl: string;
            bannerImageUrl: string;
        },
    ) {
        const profileData = {
            name: data.name,
            bio: data.bio,
            username: data.username,
            avatarUrl: data.avatarUrl ? new URL(data.avatarUrl) : null,
            bannerImageUrl: data.bannerImageUrl
                ? new URL(data.bannerImageUrl)
                : null,
        };

        const updated = account.updateProfile(profileData);

        await this.accountRepository.save(updated);
    }

    async updateAccountByApId(
        apId: URL,
        data: {
            name: string | null;
            bio: string | null;
            username: string;
            avatarUrl: string | null;
            bannerImageUrl: string | null;
            url: string | null;
            customFields: Record<string, string> | null;
        },
    ): Promise<Result<true, 'account-not-found'>> {
        const profileData = {
            name: data.name,
            bio: data.bio,
            username: data.username,
            avatarUrl: data.avatarUrl ? new URL(data.avatarUrl) : null,
            bannerImageUrl: data.bannerImageUrl
                ? new URL(data.bannerImageUrl)
                : null,
            url: data.url ? new URL(data.url) : null,
            customFields: data.customFields,
        };

        const account = await this.accountRepository.getByApId(apId);

        if (!account) {
            return error('account-not-found');
        }

        const updated = account.updateProfile(profileData);

        await this.accountRepository.save(updated);

        return ok(true);
    }

    async blockAccountByApId(
        account: Account,
        apId: URL,
    ): Promise<Result<true, RemoteAccountFetchError>> {
        const accountToBlockResult = await this.ensureByApId(apId);

        if (isError(accountToBlockResult)) {
            return accountToBlockResult;
        }

        const accountToBlock = getValue(accountToBlockResult);

        const updated = account.block(accountToBlock);

        await this.accountRepository.save(updated);

        return ok(true);
    }

    async unblockAccountByApId(
        account: Account,
        apId: URL,
    ): Promise<Result<true, RemoteAccountFetchError>> {
        const accountToUnblockResult = await this.ensureByApId(apId);

        if (isError(accountToUnblockResult)) {
            return accountToUnblockResult;
        }

        const accountToUnblock = getValue(accountToUnblockResult);

        const updated = account.unblock(accountToUnblock);

        await this.accountRepository.save(updated);

        return ok(true);
    }

    async getAccountById(id: number) {
        return await this.accountRepository.getById(id);
    }

    async blockDomain(
        account: Account,
        domain: URL,
    ): Promise<Result<true, never>> {
        const updated = account.blockDomain(domain);
        await this.accountRepository.save(updated);
        return ok(true);
    }

    async unblockDomain(
        account: Account,
        domain: URL,
    ): Promise<Result<true, never>> {
        const updated = account.unblockDomain(domain);
        await this.accountRepository.save(updated);
        return ok(true);
    }

    async followAccount(account: Account, accountToFollow: Account) {
        const updated = account.follow(accountToFollow);

        await this.accountRepository.save(updated);
    }

    async unfollowAccount(account: Account, accountToUnfollow: Account) {
        const updated = account.unfollow(accountToUnfollow);

        await this.accountRepository.save(updated);
    }

    async readAllNotifications(account: Account) {
        const updated = account.readAllNotifications();

        await this.accountRepository.save(updated);
    }

    // TODO Move all methods below to a delivery service

    async shouldDeliverActivity(inboxUrl: URL): Promise<boolean> {
        const account = await this.accountRepository.getByInboxUrl(inboxUrl);
        if (!account) {
            return false;
        }

        return !account.isInternal;
    }

    async recordDeliveryFailure(
        inboxUrl: URL,
        failureReason: string,
    ): Promise<void> {
        const account = await this.accountRepository.getByInboxUrl(inboxUrl);

        if (!account) {
            return;
        }

        const existing = await this.db('account_delivery_backoffs')
            .where('account_id', account.id)
            .first();

        if (existing) {
            const newBackoffSeconds =
                existing.backoff_seconds * DELIVERY_FAILURE_BACKOFF_MULTIPLIER;
            const backoffUntil = new Date(
                Date.now() + newBackoffSeconds * 1000,
            );

            await this.db('account_delivery_backoffs')
                .where('account_id', account.id)
                .update({
                    last_failure_at: this.db.fn.now(),
                    last_failure_reason: failureReason,
                    backoff_until: backoffUntil,
                    backoff_seconds: newBackoffSeconds,
                });
        } else {
            const backoffUntil = new Date(
                Date.now() + DELIVERY_FAILURE_BACKOFF_SECONDS * 1000,
            );

            await this.db('account_delivery_backoffs').insert({
                account_id: account.id,
                last_failure_reason: failureReason,
                backoff_until: backoffUntil,
                backoff_seconds: DELIVERY_FAILURE_BACKOFF_SECONDS,
            });
        }
    }

    async clearDeliveryFailure(inboxUrl: URL): Promise<void> {
        const account = await this.accountRepository.getByInboxUrl(inboxUrl);

        if (!account) {
            return;
        }

        await this.db('account_delivery_backoffs')
            .where('account_id', account.id)
            .delete();
    }

    async getActiveDeliveryBackoff(inboxUrl: URL): Promise<{
        backoffUntil: Date;
        backoffSeconds: number;
    } | null> {
        const backoff = await this.db('account_delivery_backoffs')
            .join(
                'accounts',
                'accounts.id',
                'account_delivery_backoffs.account_id',
            )
            .whereRaw(
                'accounts.ap_inbox_url_hash = UNHEX(SHA2(LOWER(?), 256))',
                [inboxUrl.href],
            )
            .where(
                'account_delivery_backoffs.backoff_until',
                '>',
                this.db.fn.now(),
            )
            .select(
                'account_delivery_backoffs.backoff_until',
                'account_delivery_backoffs.backoff_seconds',
            )
            .first();

        if (!backoff) {
            return null;
        }

        return {
            backoffUntil: backoff.backoff_until,
            backoffSeconds: backoff.backoff_seconds,
        };
    }

    async getKeyPair(
        accountId: number,
    ): Promise<
        Result<
            { publicKey: string; privateKey: string },
            'account-not-found' | 'key-pair-not-found'
        >
    > {
        const account = await this.accountRepository.getKeyPair(accountId);

        if (!account) {
            return error('account-not-found');
        }

        if (!account.publicKey || !account.privateKey) {
            return error('key-pair-not-found');
        }

        return ok({
            publicKey: account.publicKey,
            privateKey: account.privateKey,
        });
    }
}
