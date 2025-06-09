import { randomUUID } from 'node:crypto';
import type { AsyncEvents } from 'core/events';
import type { Knex } from 'knex';
import { parseURL } from '../core/url';
import type { Site } from '../site/site.service';
import { AccountBlockedEvent } from './account-blocked.event';
import { AccountFollowedEvent } from './account-followed.event';
import { AccountUnblockedEvent } from './account-unblocked.event';
import { AccountUnfollowedEvent } from './account-unfollowed.event';
import { type Account, AccountEntity } from './account.entity';
import { DomainBlockedEvent } from './domain-blocked.event';
import { DomainUnblockedEvent } from './domain-unblocked.event';

interface AccountRow {
    id: number;
    uuid: string | null;
    username: string;
    name: string | null;
    bio: string | null;
    url: string | null;
    avatar_url: string | null;
    banner_image_url: string | null;
    ap_id: string;
    ap_followers_url: string | null;
    ap_inbox_url: string | null;
    site_id: number | null;
}

export class KnexAccountRepository {
    constructor(
        private readonly db: Knex,
        private readonly events: AsyncEvents,
    ) {}

    async save(account: Account): Promise<void> {
        const events = AccountEntity.pullEvents(account);
        await this.db.transaction(async (transaction) => {
            const rows = await transaction('accounts')
                .update({
                    name: account.name,
                    bio: account.bio,
                    username: account.username,
                    avatar_url: account.avatarUrl?.href ?? null,
                    banner_image_url: account.bannerImageUrl?.href ?? null,
                })
                .where({ id: account.id });

            if (rows !== 1) {
                throw new Error(
                    `Account ${account.id} not found during save()`,
                );
            }

            for (const event of events) {
                if (event instanceof AccountBlockedEvent) {
                    await transaction('blocks')
                        .insert({
                            blocker_id: event.getBlockerId(),
                            blocked_id: event.getAccountId(),
                        })
                        .onConflict(['blocker_id', 'blocked_id'])
                        .ignore();

                    await transaction('follows')
                        .where({
                            follower_id: event.getBlockerId(),
                            following_id: event.getAccountId(),
                        })
                        .orWhere({
                            follower_id: event.getAccountId(),
                            following_id: event.getBlockerId(),
                        })
                        .delete();
                } else if (event instanceof AccountUnblockedEvent) {
                    await transaction('blocks')
                        .where({
                            blocker_id: event.getUnblockerId(),
                            blocked_id: event.getAccountId(),
                        })
                        .delete();
                } else if (event instanceof DomainBlockedEvent) {
                    await transaction('domain_blocks')
                        .insert({
                            blocker_id: event.getBlockerId(),
                            domain: event.getDomain().hostname,
                        })
                        .onConflict(['blocker_id', 'domain'])
                        .ignore();

                    // Remove follows between the blocker and any accounts from the blocked domain
                    const blockerId = event.getBlockerId();
                    const domainHostname = event.getDomain().hostname;

                    // Delete follows where the blocker follows accounts from the blocked domain
                    await transaction('follows')
                        .join(
                            'accounts',
                            'follows.following_id',
                            '=',
                            'accounts.id',
                        )
                        .where('follows.follower_id', blockerId)
                        .whereRaw(
                            'accounts.domain_hash = UNHEX(SHA2(LOWER(?), 256))',
                            [domainHostname],
                        )
                        .delete();

                    // Delete follows where accounts from the blocked domain follow the blocker
                    await transaction('follows')
                        .join(
                            'accounts',
                            'follows.follower_id',
                            '=',
                            'accounts.id',
                        )
                        .where('follows.following_id', blockerId)
                        .whereRaw(
                            'accounts.domain_hash = UNHEX(SHA2(LOWER(?), 256))',
                            [domainHostname],
                        )
                        .delete();
                } else if (event instanceof DomainUnblockedEvent) {
                    await transaction('domain_blocks')
                        .where({
                            blocker_id: event.getUnblockerId(),
                            domain: event.getDomain().hostname,
                        })
                        .delete();
                } else if (event instanceof AccountFollowedEvent) {
                    await transaction('follows')
                        .insert({
                            follower_id: event.getFollowerId(),
                            following_id: event.getAccountId(),
                        })
                        .onConflict(['follower_id', 'following_id'])
                        .ignore();
                } else if (event instanceof AccountUnfollowedEvent) {
                    await transaction('follows')
                        .where({
                            follower_id: event.getUnfollowerId(),
                            following_id: event.getAccountId(),
                        })
                        .delete();
                }
            }
        });

        for (const event of events) {
            await this.events.emitAsync(event.getName(), event);
        }
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
                'accounts.ap_inbox_url',
            )
            .first();

        if (!accountRow) {
            throw new Error(`Default account not found for site ${site.id}`);
        }

        return this.mapRowToAccountEntity(accountRow);
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
                'accounts.ap_inbox_url',
                'users.site_id',
            )
            .first();

        if (!accountRow) {
            return null;
        }

        return this.mapRowToAccountEntity(accountRow);
    }

    async getById(id: number): Promise<Account | null> {
        const accountRow = await this.db('accounts')
            .where('accounts.id', id)
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
                'accounts.ap_inbox_url',
                'users.site_id',
            )
            .first();

        if (!accountRow) {
            return null;
        }

        return this.mapRowToAccountEntity(accountRow);
    }

    private async mapRowToAccountEntity(row: AccountRow): Promise<Account> {
        if (!row.uuid) {
            row.uuid = randomUUID();
            await this.db('accounts')
                .update({ uuid: row.uuid })
                .where({ id: row.id });
        }

        return AccountEntity.create({
            id: row.id,
            uuid: row.uuid,
            username: row.username,
            name: row.name,
            bio: row.bio,
            url: parseURL(row.url) || new URL(row.ap_id),
            avatarUrl: parseURL(row.avatar_url),
            bannerImageUrl: parseURL(row.banner_image_url),
            apId: new URL(row.ap_id),
            apFollowers: parseURL(row.ap_followers_url),
            apInbox: parseURL(row.ap_inbox_url),
            isInternal: row.site_id !== null,
        });
    }
}
