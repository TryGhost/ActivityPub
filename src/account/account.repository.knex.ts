import { randomUUID } from 'node:crypto';
import type { AsyncEvents } from 'core/events';
import type { Knex } from 'knex';
import { parseURL } from '../core/url';
import type { Site } from '../site/site.service';
import { AccountUpdatedEvent } from './account-updated.event';
import { Account, type AccountSite } from './account.entity';

export class KnexAccountRepository {
    constructor(
        private readonly db: Knex,
        private readonly events: AsyncEvents,
    ) {}

    async save(account: Account): Promise<void> {
        if (account.isNew) {
            throw new Error(
                'Saving of new Accounts has not been implemented yet.',
            );
        }

        await this.db('accounts')
            .update({
                name: account.name,
                bio: account.bio,
                username: account.username,
                avatar_url: account.avatarUrl?.href,
                banner_image_url: account.bannerImageUrl?.href,
            })
            .where({ id: account.id });

        await this.events.emitAsync(
            AccountUpdatedEvent.getName(),
            new AccountUpdatedEvent(account),
        );
    }

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
        );

        return account;
    }
}
