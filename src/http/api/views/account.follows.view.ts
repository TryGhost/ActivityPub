import { CollectionPage, isActor, lookupObject } from '@fedify/fedify';
import type { Account, PersistedAccount } from 'account/account.entity';
import { getAccountHandle } from 'account/utils';
import type { FedifyContextFactory } from 'activitypub/fedify-context.factory';
import { type Result, error, ok } from 'core/result';
import type { Knex } from 'knex';

/**
 * Maximum number of follow accounts to return
 */
const FOLLOWS_LIMIT = 20;

export type GetFollowsError =
    | 'invalid-next-parameter'
    | 'error-getting-follows'
    | 'not-an-actor';

interface AccountInfo {
    id: string;
    name: string;
    handle: string;
    avatarUrl: string;
    isFollowing: boolean;
}

export interface AccountFollows {
    accounts: AccountInfo[];
    next: string | null;
}

interface AccountRow {
    id: number;
    ap_id: string;
    name: string;
    username: string;
    avatar_url: string;
}

interface FollowsActor {
    id: string;
    name: string;
    preferredUsername: string;
    icon: {
        url: string;
    };
}

function isValidFollowsActor(obj: unknown): obj is FollowsActor {
    if (!obj || typeof obj !== 'object') {
        return false;
    }

    if (!('id' in obj) || typeof obj.id !== 'string') {
        return false;
    }

    if (!('name' in obj) || typeof obj.name !== 'string') {
        return false;
    }

    if (
        !('preferredUsername' in obj) ||
        typeof obj.preferredUsername !== 'string'
    ) {
        return false;
    }

    if (
        !('icon' in obj) ||
        !obj.icon ||
        typeof obj.icon !== 'object' ||
        !('url' in obj.icon) ||
        typeof obj.icon.url !== 'string'
    ) {
        return false;
    }

    return true;
}

export class AccountFollowsView {
    constructor(
        private readonly db: Knex,
        private readonly fedifyContextFactory: FedifyContextFactory,
    ) {}

    async getFollowsByAccount(
        account: Account,
        type: string,
        next: number,
        siteDefaultAccount: PersistedAccount,
    ): Promise<AccountFollows> {
        if (!account.id) {
            throw new Error('Account not found');
        }

        const getAccounts =
            type === 'following'
                ? this.getFollowingAccounts.bind(this)
                : this.getFollowerAccounts.bind(this);
        const getAccountsCount =
            type === 'following'
                ? this.getFollowingAccountsCount.bind(this)
                : this.getFollowerAccountsCount.bind(this);

        const results = await getAccounts(account.id, FOLLOWS_LIMIT, next);
        const total = await getAccountsCount(account.id);

        const nextCursor =
            total > next + FOLLOWS_LIMIT
                ? (next + FOLLOWS_LIMIT).toString()
                : null;

        const accounts: AccountInfo[] = [];

        for (const result of results) {
            accounts.push({
                id: String(result.id),
                name: result.name || '',
                handle: getAccountHandle(
                    new URL(result.ap_id).host,
                    result.username,
                ),
                avatarUrl: result.avatar_url || '',
                isFollowing: await this.checkIfAccountIsFollowing(
                    siteDefaultAccount.id,
                    result.id,
                ),
            });
        }

        return {
            accounts: accounts,
            next: nextCursor,
        };
    }

    async getFollowsByRemoteLookUp(
        apId: URL,
        next: string,
        type: string,
        siteDefaultAccount: PersistedAccount,
    ): Promise<Result<AccountFollows, GetFollowsError>> {
        const ctx = this.fedifyContextFactory.getFedifyContext();
        const accounts: AccountInfo[] = [];

        const documentLoader = await ctx.getDocumentLoader({
            handle: 'index',
        });

        // Lookup actor by handle
        const actor = await lookupObject(apId, { documentLoader });

        if (!isActor(actor)) {
            return error('not-an-actor');
        }

        let page: CollectionPage | null = null;

        try {
            //next would be a number only in case of non-paginated follow lists
            if (next !== '' && !Number(next)) {
                // Ensure the next parameter is for the same host as the actor. We
                // do this to prevent blindly passing URIs to lookupObject (i.e next
                // param has been tampered with)
                // @TODO: Does this provide enough security? Can the host of the
                // actor be different to the host of the actor's following collection?
                const { host: actorHost } = actor?.id || new URL('');
                const { host: nextHost } = new URL(next);

                if (actorHost !== nextHost) {
                    return error('invalid-next-parameter');
                }

                page = (await lookupObject(next, {
                    documentLoader,
                })) as CollectionPage | null;

                // Check that we have a valid page
                if (!(page instanceof CollectionPage) || !page?.itemIds) {
                    page = null;
                }
            } else if (next === '') {
                const follows =
                    type === 'following'
                        ? await actor.getFollowing()
                        : await actor.getFollowers();

                if (follows) {
                    page = await follows.getFirst();
                }
            }
        } catch (err) {
            return error('error-getting-follows');
        }

        // Handling non-paginated follow lists
        if (!page || Number(next)) {
            const follows =
                type === 'following'
                    ? await actor.getFollowing()
                    : await actor.getFollowers();

            if (!follows) {
                return error('error-getting-follows');
            }

            const pageSize = 15;
            const pageNumber = next ? Number.parseInt(next, 10) : 1;
            const startIndex = (pageNumber - 1) * pageSize;

            const pageUrls = follows.itemIds.slice(
                startIndex,
                startIndex + pageSize,
            );

            for await (const item of pageUrls) {
                try {
                    const followeeAccount = await this.db('accounts')
                        .whereRaw('accounts.ap_id_hash = UNHEX(SHA2(?, 256))', [
                            item.href || '',
                        ])
                        .first();

                    if (followeeAccount) {
                        accounts.push({
                            id: String(followeeAccount.id),
                            name: followeeAccount.name || '',
                            handle: getAccountHandle(
                                new URL(followeeAccount.ap_id).host,
                                followeeAccount.username,
                            ),
                            avatarUrl: followeeAccount.avatar_url || '',
                            isFollowing: await this.checkIfAccountIsFollowing(
                                siteDefaultAccount.id,
                                followeeAccount.id,
                            ),
                        });
                    } else {
                        const followsActorObj = await lookupObject(item.href, {
                            documentLoader,
                        });

                        if (!isActor(followsActorObj)) {
                            continue;
                        }

                        const followsActor = (await followsActorObj.toJsonLd({
                            format: 'compact',
                        })) as unknown;

                        if (!isValidFollowsActor(followsActor)) {
                            continue;
                        }

                        accounts.push({
                            id: followsActor.id,
                            name: followsActor.name,
                            handle: getAccountHandle(
                                new URL(followsActor.id).host,
                                followsActor.preferredUsername,
                            ),
                            avatarUrl: followsActor.icon.url,
                            isFollowing: false,
                        });
                    }
                } catch {
                    ctx.data.logger.error(
                        `Error while iterating over follow list for ${actor.name}`,
                    );
                    // Skip this item if processing fails
                    // This ensures that a single invalid or unreachable follow doesn't block the API from returning valid follows
                    // If fetching any one follow fails, we can still return the other valid follows in the collection
                }
            }

            let nextCursor = null;

            if (
                follows.totalItems &&
                pageNumber * pageSize < follows.totalItems
            ) {
                nextCursor = (pageNumber + 1).toString();
            }

            return ok({
                accounts: accounts,
                total: 0,
                next: nextCursor,
            });
        }

        for await (const item of page.itemIds) {
            try {
                const followeeAccount = await this.db('accounts')
                    .whereRaw('accounts.ap_id_hash = UNHEX(SHA2(?, 256))', [
                        item.href || '',
                    ])
                    .first();

                if (followeeAccount) {
                    accounts.push({
                        id: String(followeeAccount.id),
                        name: followeeAccount.name || '',
                        handle: getAccountHandle(
                            new URL(followeeAccount.ap_id).host,
                            followeeAccount.username,
                        ),
                        avatarUrl: followeeAccount.avatar_url || '',
                        isFollowing: await this.checkIfAccountIsFollowing(
                            siteDefaultAccount.id,
                            followeeAccount.id,
                        ),
                    });
                } else {
                    const followsActorObj = await lookupObject(item.href, {
                        documentLoader,
                    });

                    if (!isActor(followsActorObj)) {
                        continue;
                    }

                    const followsActor = (await followsActorObj.toJsonLd({
                        format: 'compact',
                    })) as unknown;

                    if (!isValidFollowsActor(followsActor)) {
                        continue;
                    }

                    accounts.push({
                        id: followsActor.id,
                        name: followsActor.name,
                        handle: getAccountHandle(
                            new URL(followsActor.id).host,
                            followsActor.preferredUsername,
                        ),
                        avatarUrl: followsActor.icon.url,
                        isFollowing: false,
                    });
                }
            } catch {
                ctx.data.logger.error(
                    `Error while iterating over follow list for ${actor.name}`,
                );
                // Skip this item if processing fails
                // This ensures that a single invalid or unreachable follow doesn't block the API from returning valid follows
                // If fetching any one follow fails, we can still return the other valid follows in the collection
            }
        }

        const nextCursor = page.nextId
            ? encodeURIComponent(page.nextId.toString())
            : null;

        return ok({
            accounts: accounts,
            next: nextCursor,
        });
    }

    private async getFollowingAccountsCount(
        accountId: number,
    ): Promise<number> {
        const result = await this.db('follows')
            .where('follower_id', accountId)
            .count('*', { as: 'count' });

        return Number(result[0].count);
    }

    private async getFollowerAccountsCount(accountId: number): Promise<number> {
        const result = await this.db('follows')
            .where('following_id', accountId)
            .count('*', { as: 'count' });

        return Number(result[0].count);
    }

    private async getFollowerAccounts(
        accountId: number,
        limit: number,
        offset: number,
    ): Promise<AccountRow[]> {
        return await this.db('follows')
            .select([
                'accounts.id',
                'accounts.ap_id',
                'accounts.name',
                'accounts.username',
                'accounts.avatar_url',
            ])
            .where('follows.following_id', accountId)
            .innerJoin('accounts', 'accounts.id', 'follows.follower_id')
            .limit(limit)
            .offset(offset)
            // order by the date created at in descending order and then by the
            // account id in descending order to ensure the most recent follows
            // are returned first (i.e in case multiple follows were created at
            // the same time)
            .orderBy('follows.created_at', 'desc')
            .orderBy('accounts.id', 'desc');
    }

    private async getFollowingAccounts(
        accountId: number,
        limit: number,
        offset: number,
    ): Promise<AccountRow[]> {
        return await this.db('follows')
            .select([
                'accounts.id',
                'accounts.ap_id',
                'accounts.name',
                'accounts.username',
                'accounts.avatar_url',
            ])
            .where('follows.follower_id', accountId)
            .innerJoin('accounts', 'accounts.id', 'follows.following_id')
            .limit(limit)
            .offset(offset)
            // order by the date created at in descending order and then by the
            // account id in descending order to ensure the most recent follows
            // are returned first (i.e in case multiple follows were created at
            // the same time)
            .orderBy('follows.created_at', 'desc')
            .orderBy('accounts.id', 'desc');
    }

    private async checkIfAccountIsFollowing(
        accountId: number,
        followeeAccountId: number,
    ): Promise<boolean> {
        const result = await this.db('follows')
            .where('follower_id', accountId)
            .where('following_id', followeeAccountId)
            .select(1)
            .first();

        return result !== undefined;
    }
}
