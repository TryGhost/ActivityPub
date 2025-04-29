import { randomUUID } from 'node:crypto';
import type { AsyncEvents } from 'core/events';
import type { Knex } from 'knex';
import { parseURL } from '../core/url';
import type { Site } from '../site/site.service';
import { AccountUpdatedEvent } from './account-updated.event';
import { type Account, AccountEntity } from './account.entity';

export class KnexAccountRepository {
    constructor(
        private readonly db: Knex,
        private readonly events: AsyncEvents,
    ) {}

    async save(account: Account): Promise<void> {
        await this.db('accounts')
            .update({
                name: account.name,
                bio: account.bio,
                username: account.username,
                avatar_url: account.avatarUrl?.href ?? null,
                banner_image_url: account.bannerImageUrl?.href ?? null,
            })
            .where({ id: account.id });

        const events = AccountEntity.pullEvents(account);

        for (const event of events) {
            await this.events.emitAsync(event.getName(), event);
        }

        await this.events.emitAsync(
            AccountUpdatedEvent.getName(),
            new AccountUpdatedEvent(account),
        );
    }

    /**
     * @deprecated
     * Use `ctx.get('account')` instead
     */
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
        const accountRow = await this.db('accounts')
            .where('id', user.account_id)
            .select(
                'accounts.id',
                'accounts.uuid',
                'accounts.username',
                'accounts.name',
                'accounts.bio',
                'accounts.url',
                'accounts.avatar_url',
                'accounts.banner_image_url',
                'accounts.ap_id',
                'accounts.ap_followers_url',
            )
            .first();

        if (!accountRow) {
            throw new Error(`Default account not found for site ${site.id}`);
        }

        if (!accountRow.uuid) {
            accountRow.uuid = randomUUID();
            await this.db('accounts')
                .update({ uuid: accountRow.uuid })
                .where({ id: accountRow.id });
        }

        return AccountEntity.create({
            id: accountRow.id,
            uuid: accountRow.uuid,
            username: accountRow.username,
            name: accountRow.name,
            bio: accountRow.bio,
            url: parseURL(accountRow.url) || new URL(accountRow.ap_id),
            avatarUrl: parseURL(accountRow.avatar_url),
            bannerImageUrl: parseURL(accountRow.banner_image_url),
            apId: new URL(accountRow.ap_id),
            apFollowers: parseURL(accountRow.ap_followers_url),
            isInternal: true,
        });
    }

    async getByApId(apId: URL): Promise<Account | null> {
        const accountRow = await this.db('accounts')
            .whereRaw('ap_id_hash = UNHEX(SHA2(?, 256))', [apId.href])
            .leftJoin('users', 'users.account_id', 'accounts.id')
            .select(
                'accounts.id',
                'accounts.uuid',
                'accounts.username',
                'accounts.name',
                'accounts.bio',
                'accounts.url',
                'accounts.avatar_url',
                'accounts.banner_image_url',
                'accounts.ap_id',
                'accounts.ap_followers_url',
                'users.site_id',
            )
            .first();

        if (!accountRow) {
            return null;
        }

        if (!accountRow.uuid) {
            accountRow.uuid = randomUUID();
            await this.db('accounts')
                .update({ uuid: accountRow.uuid })
                .where({ id: accountRow.id });
        }

        return AccountEntity.create({
            id: accountRow.id,
            uuid: accountRow.uuid,
            username: accountRow.username,
            name: accountRow.name,
            bio: accountRow.bio,
            url: parseURL(accountRow.url) || new URL(accountRow.ap_id),
            avatarUrl: parseURL(accountRow.avatar_url),
            bannerImageUrl: parseURL(accountRow.banner_image_url),
            apId: new URL(accountRow.ap_id),
            apFollowers: parseURL(accountRow.ap_followers_url),
            isInternal: accountRow.site_id !== null,
        });
    }
}
