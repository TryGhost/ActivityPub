import { CollectionPage, isActor, lookupObject } from '@fedify/fedify';
import type { Account } from 'account/account.entity';
import { getAccountHandle } from 'account/utils';
import type { FedifyContextFactory } from 'activitypub/fedify-context.factory';
import { isUri } from 'helpers/uri';
import type { Knex } from 'knex';

/**
 * Maximum number of follow accounts to return
 */
const FOLLOWS_LIMIT = 20;

interface AccountInfo {
    id: string;
    name: string;
    handle: string;
    avatarUrl: string;
    isFollowing: boolean;
}

export interface AccountFollows {
    accounts: AccountInfo[];
    total: number;
    next: string | null;
}

interface AccountRow {
    id: number;
    ap_id: string;
    name: string;
    username: string;
    avatar_url: string;
}

export class AccountFollowsView {
    constructor(
        private readonly db: Knex,
        private readonly fedifyContextFactory: FedifyContextFactory,
    ) {}

    async getFollowsByHandle(
        handle: string,
        account: Account | null,
        type: string,
        offset: string | null,
        siteDefaultAccount: Account,
    ): Promise<AccountFollows> {
        //If we found the account in our db and it's an internal account, do an internal lookup
        if (account?.isInternal) {
            return await this.getFollowsByAccount(
                account,
                type,
                Number.parseInt(offset || '0'),
                siteDefaultAccount,
            );
        }

        //Otherwise, do a remote lookup to fetch the posts
        return this.getFollowsByRemoteLookUp(
            handle,
            offset || '',
            type,
            siteDefaultAccount,
        );
    }

    async getFollowsByAccount(
        account: Account,
        type: string,
        offset: number,
        siteDefaultAccount: Account,
    ): Promise<AccountFollows> {
        if (!siteDefaultAccount.id) {
            throw new Error('Site default account not found');
        }

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

        const results = await getAccounts(account.id, FOLLOWS_LIMIT, offset);
        const total = await getAccountsCount(account.id);

        const next =
            total > offset + FOLLOWS_LIMIT
                ? (offset + FOLLOWS_LIMIT).toString()
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
            total: total,
            next: next,
        };
    }

    async getFollowsByRemoteLookUp(
        handle: string,
        next: string,
        type: string,
        siteDefaultAccount: Account,
    ): Promise<AccountFollows> {
        // If the next parameter is not a valid URI, return early
        if (next !== '' && !isUri(next)) {
            throw new Error('Invalid next parameter');
        }

        const ctx = this.fedifyContextFactory.getFedifyContext();

        const documentLoader = await ctx.getDocumentLoader({
            handle: 'index',
        });

        // Lookup actor by handle
        const actor = await lookupObject(handle, { documentLoader });

        if (!isActor(actor)) {
            throw new Error('Invalid actor');
        }

        if (!siteDefaultAccount.id) {
            throw new Error('Site default account not found');
        }

        let page: CollectionPage | null = null;

        try {
            if (next !== '') {
                // Ensure the next parameter is for the same host as the actor. We
                // do this to prevent blindly passing URIs to lookupObject (i.e next
                // param has been tampered with)
                // @TODO: Does this provide enough security? Can the host of the
                // actor be different to the host of the actor's following collection?
                const { host: actorHost } = actor?.id || new URL('');
                const { host: nextHost } = new URL(next);

                if (actorHost !== nextHost) {
                    throw new Error('Invalid next parameter');
                }

                page = (await lookupObject(next, {
                    documentLoader,
                })) as CollectionPage | null;

                // Check that we have a valid page
                if (!(page instanceof CollectionPage) || !page?.itemIds) {
                    page = null;
                }
            } else {
                const follows =
                    type === 'following'
                        ? await actor.getFollowing()
                        : await actor.getFollowers();

                if (follows) {
                    page = await follows.getFirst();
                }
            }
        } catch (err) {
            throw new Error('Error getting follows');
        }

        if (!page) {
            throw new Error('Page not found');
        }

        const accounts: AccountInfo[] = [];
        try {
            for await (const item of page.getItems()) {
                const actor = (await item.toJsonLd({
                    format: 'compact',
                    // TODO: Clean up the any type
                    // biome-ignore lint/suspicious/noExplicitAny: Legacy code needs proper typing
                })) as any;

                const followeeAccount = await this.db('accounts')
                    .where('ap_id', actor.id?.toString() || '')
                    .first();

                accounts.push({
                    id: actor.id || '',
                    name: actor.name || '',
                    handle: getAccountHandle(
                        new URL(actor.id).host,
                        actor.preferredUsername,
                    ),
                    avatarUrl: actor.icon?.url || '',
                    isFollowing: followeeAccount
                        ? await this.checkIfAccountIsFollowing(
                              siteDefaultAccount.id,
                              followeeAccount.id,
                          )
                        : false,
                });
            }
        } catch (err) {
            throw new Error('Error getting follows');
        }

        const nextCursor = page.nextId
            ? encodeURIComponent(page.nextId.toString())
            : null;

        return {
            accounts: accounts,
            total: 0,
            next: nextCursor,
        };
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
