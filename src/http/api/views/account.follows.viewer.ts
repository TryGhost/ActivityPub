import type { Account } from 'account/account.entity';
import { getAccountHandle } from 'account/utils';
import type { Knex } from 'knex';
import type { FedifyContextFactory } from '../../../activitypub/fedify-context.factory';

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

interface AccountFollowsView {
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

export class AccountFollowsViewer {
    /**
     * @param db Database client
     */
    constructor(
        private readonly db: Knex,
        private readonly fedifyContextFactory: FedifyContextFactory,
    ) {}

    async getFollows(
        type: string,
        siteDefaultAccount: Account,
        offset: number,
    ): Promise<AccountFollowsView> {
        if (!siteDefaultAccount.id) {
            throw new Error('Site default account not found');
        }

        // Retrieve data
        const getAccounts =
            type === 'following'
                ? this.getFollowingAccounts.bind(this)
                : this.getFollowerAccounts.bind(this);
        const getAccountsCount =
            type === 'following'
                ? this.getFollowingAccountsCount.bind(this)
                : this.getFollowerAccountsCount.bind(this);

        const results = await getAccounts(
            siteDefaultAccount.id,
            FOLLOWS_LIMIT,
            offset,
        );
        const total = await getAccountsCount(siteDefaultAccount.id);

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
                isFollowing:
                    type === 'following'
                        ? true
                        : await this.checkIfAccountIsFollowing(
                              siteDefaultAccount.id,
                              result.id,
                          ),
            });
        }

        const accountFollowsView: AccountFollowsView = {
            accounts: accounts,
            total: total,
            next: next,
        };
        return accountFollowsView;
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
     * Get the accounts that are following the provided account
     *
     * The results are ordered in reverse chronological order
     *
     * @param accountId id of the account
     * @param limit limit of the query
     * @param offset offset of the query
     */
    async getFollowerAccounts(
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
            // @TODO: Make this configurable via the options?
            .orderBy('follows.created_at', 'desc')
            .orderBy('accounts.id', 'desc');
    }

    /**
     * Get the accounts that the provided account is following
     *
     * The results are ordered in reverse chronological order
     *
     * @param accountId id of the account
     * @param limit limit of the query
     * @param offset offset of the query
     */
    async getFollowingAccounts(
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
            // @TODO: Make this configurable via the options?
            .orderBy('follows.created_at', 'desc')
            .orderBy('accounts.id', 'desc');
    }

    /**
     * Check if an account is following another account
     *
     * @param accountId id of the account to check
     * @param followeeAccountId: id of the followee account
     */
    async checkIfAccountIsFollowing(
        accountId: number | null,
        followeeAccountId: number | null,
    ): Promise<boolean> {
        if (!accountId || !followeeAccountId) {
            return false;
        }

        const result = await this.db('follows')
            .where('follower_id', accountId)
            .where('following_id', followeeAccountId)
            .select(1)
            .first();

        return result !== undefined;
    }
}
