import type { Account } from 'account/account.entity';
import { getAccountHandle } from 'account/utils';
import type { FedifyContextFactory } from 'activitypub/fedify-context.factory';
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
