import { randomUUID } from 'node:crypto';
import type { AsyncEvents } from 'core/events';
import type { Knex } from 'knex';
import { parseURL } from '../core/url';
import type { Site } from '../site/site.service';
import { Account, type AccountSite } from './account.entity';

export class KnexAccountRepository {
    constructor(
        private readonly db: Knex,
        private readonly events: AsyncEvents,
    ) {}

    async getBySite(site: Site): Promise<Account> {
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
            .select(
                'accounts.id',
                'accounts.uuid',
                'accounts.username',
                'accounts.name',
                'accounts.bio',
                'accounts.avatar_url',
                'accounts.banner_image_url',
                'accounts.ap_id',
                'accounts.url',
                'accounts.ap_followers_url',
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
            .where('id', user.account_id)
            .first();

        if (!account) {
            throw new Error(`Default account not found for site ${site.id}`);
        }

        if (!account.uuid) {
            account.uuid = randomUUID();
            await this.db('accounts')
                .update({ uuid: account.uuid })
                .where({ id: account.id });
        }

        return new Account(
            user.account_id,
            account.uuid,
            account.username,
            account.name,
            account.bio,
            parseURL(account.avatar_url),
            parseURL(account.banner_image_url),
            {
                id: site.id,
                host: site.host,
            },
            parseURL(account.ap_id),
            parseURL(account.url),
            parseURL(account.ap_followers_url),
            account.post_count,
            account.repost_count,
            account.like_count,
            account.follower_count,
            account.following_count,
        );
    }

    async getByApId(apId: URL): Promise<Account | null> {
        const accountRow = await this.db('accounts')
            .where('accounts.ap_id', apId.href)
            .leftJoin('users', 'users.account_id', 'accounts.id')
            .leftJoin('sites', 'sites.id', 'users.site_id')
            .select(
                'accounts.id',
                'accounts.username',
                'accounts.name',
                'accounts.bio',
                'accounts.avatar_url',
                'accounts.banner_image_url',
                'accounts.ap_id',
                'accounts.url',
                'accounts.ap_followers_url',
                'users.site_id',
                'sites.host',
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

        if (!accountRow) {
            return null;
        }

        let site: AccountSite | null = null;
        if (
            typeof accountRow.site_id === 'number' &&
            typeof accountRow.host === 'string'
        ) {
            site = {
                id: accountRow.site_id,
                host: accountRow.host,
            };
        }

        if (!accountRow.uuid) {
            accountRow.uuid = randomUUID();
            await this.db('accounts')
                .update({ uuid: accountRow.uuid })
                .where({ id: accountRow.id });
        }

        const account = new Account(
            accountRow.id,
            accountRow.uuid,
            accountRow.username,
            accountRow.name,
            accountRow.bio,
            parseURL(accountRow.avatar_url),
            parseURL(accountRow.banner_image_url),
            site,
            parseURL(accountRow.ap_id),
            parseURL(accountRow.url),
            parseURL(accountRow.ap_followers_url),
            accountRow.post_count,
            accountRow.repost_count,
            accountRow.like_count,
            accountRow.follower_count,
            accountRow.following_count,
        );

        return account;
    }

    async getFollowingAccountsCount(accountId: number): Promise<number> {
        return this.getFollowCount(accountId, 'following');
    }

    async getFollowerAccountsCount(accountId: number): Promise<number> {
        return this.getFollowCount(accountId, 'followers');
    }

    private async getFollowCount(
        accountId: number,
        type: 'following' | 'followers',
    ): Promise<number> {
        const result = await this.db('follows')
            .where(
                type === 'following' ? 'follower_id' : 'following_id',
                accountId,
            )
            .count('*', { as: 'count' });

        return Number(result[0].count);
    }

    async getPostCount(
        accountId: number,
        { includeReposts = false }: { includeReposts?: boolean } = {},
    ): Promise<number> {
        const posts = await this.db('posts')
            .where('author_id', accountId)
            .count('*', { as: 'count' });

        if (includeReposts) {
            const reposts = await this.db('reposts')
                .where('account_id', accountId)
                .count('*', { as: 'count' });

            return Number(posts[0].count) + Number(reposts[0].count);
        }

        return Number(posts[0].count);
    }

    async getLikedPostsCount(accountId: number): Promise<number> {
        const result = await this.db('likes')
            .join('posts', 'likes.post_id', 'posts.id')
            .where('likes.account_id', accountId)
            .whereNull('posts.in_reply_to')
            .count('*', { as: 'count' });

        return Number(result[0].count);
    }
}
