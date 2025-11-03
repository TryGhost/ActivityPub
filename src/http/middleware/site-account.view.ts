import { randomUUID } from 'node:crypto';

import type { Knex } from 'knex';

import type { Account } from '@/account/account.entity';
import { AccountEntity } from '@/account/account.entity';
import { error, ok, type Result } from '@/core/result';
import { parseURL } from '@/core/url';
import type { Site } from '@/site/site.service';

export type SiteAccountError =
    | { type: 'missing-host'; message: string }
    | { type: 'site-not-found'; host: string }
    | { type: 'account-not-found'; siteId: number; host: string };

export interface SiteAccountData {
    site: Site;
    account: Account;
}

export class SiteAccountView {
    constructor(private readonly db: Knex) {}

    async getBySiteHost(
        host: string | undefined,
    ): Promise<Result<SiteAccountData, SiteAccountError>> {
        if (!host) {
            return error({
                type: 'missing-host',
                message: 'No Host header provided',
            });
        }

        const siteAccount = await this.db
            .select(
                'sites.id as site_id',
                'sites.host',
                'sites.webhook_secret',
                'users.account_id',
                'accounts.id as account_id',
                'accounts.uuid',
                'accounts.username',
                'accounts.name',
                'accounts.bio',
                'accounts.avatar_url',
                'accounts.banner_image_url',
                'accounts.url',
                'accounts.custom_fields',
                'accounts.ap_id',
                'accounts.ap_inbox_url',
                'accounts.ap_shared_inbox_url',
                'accounts.ap_outbox_url',
                'accounts.ap_following_url',
                'accounts.ap_followers_url',
                'accounts.ap_liked_url',
                'accounts.ap_public_key',
                'accounts.ap_private_key',
            )
            .from('sites')
            .leftJoin('users', 'sites.id', 'users.site_id')
            .leftJoin('accounts', 'users.account_id', 'accounts.id')
            .where('sites.host', host);

        if (!siteAccount || siteAccount.length === 0) {
            return error({
                type: 'site-not-found',
                host,
            });
        }

        const row = siteAccount[0];

        const site: Site = {
            id: row.site_id,
            host: row.host,
            webhook_secret: row.webhook_secret,
        };

        if (!row.account_id) {
            return error({
                type: 'account-not-found',
                siteId: site.id,
                host: site.host,
            });
        }

        // Handle UUID generation if missing
        let uuid = row.uuid;
        if (!uuid) {
            uuid = randomUUID();
            await this.db('accounts')
                .update({ uuid })
                .where({ id: row.account_id })
                .andWhere({ uuid: null });
        }

        const account = AccountEntity.create({
            id: row.account_id,
            uuid,
            username: row.username,
            name: row.name,
            bio: row.bio,
            url: new URL(row.url),
            avatarUrl: parseURL(row.avatar_url),
            bannerImageUrl: parseURL(row.banner_image_url),
            apId: new URL(row.ap_id),
            apFollowers: parseURL(row.ap_followers_url),
            apInbox: parseURL(row.ap_inbox_url),
            isInternal: row.site_id !== null,
            customFields: row.custom_fields,
        });

        return ok({ site, account });
    }
}
