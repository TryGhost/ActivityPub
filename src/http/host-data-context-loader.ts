import type { Knex } from 'knex';

import type { Account } from '@/account/account.entity';
import type { KnexAccountRepository } from '@/account/account.repository.knex';
import type { Result } from '@/core/result';
import { error, ok } from '@/core/result';
import type { Site } from '@/site/site.service';

export class HostDataContextLoader {
    constructor(
        readonly db: Knex,
        readonly accountRepository: KnexAccountRepository,
    ) {}

    async loadDataForHost(
        host: string,
    ): Promise<
        Result<
            { site: Site; account: Account },
            'site-not-found' | 'account-not-found' | 'multiple-users-for-site'
        >
    > {
        const results = await this.db('sites')
            .leftJoin('users', 'users.site_id', 'sites.id')
            .leftJoin('accounts', 'accounts.id', 'users.account_id')
            .select(
                // site
                'sites.id as site_id',
                'sites.host as site_host',
                'sites.webhook_secret as site_webhook_secret',
                'sites.ghost_uuid as site_uuid',
                // account
                'accounts.id as account_id',
                'accounts.uuid as account_uuid',
                'accounts.username as account_username',
                'accounts.name as account_name',
                'accounts.bio as account_bio',
                'accounts.url as account_url',
                'accounts.avatar_url as account_avatar_url',
                'accounts.banner_image_url as account_banner_image_url',
                'accounts.ap_id as account_ap_id',
                'accounts.ap_followers_url as account_ap_followers_url',
                'accounts.ap_inbox_url as account_ap_inbox_url',
                'accounts.ap_outbox_url as account_ap_outbox_url',
                'accounts.ap_following_url as account_ap_following_url',
                'accounts.ap_liked_url as account_ap_liked_url',
                'accounts.custom_fields as account_custom_fields',
            )
            .where('sites.host', host);

        if (results.length === 0) {
            return error('site-not-found');
        }

        if (results.length > 1) {
            return error('multiple-users-for-site');
        }

        const result = results[0];

        if (!result.account_id) {
            return error('account-not-found');
        }

        const site: Site = {
            id: result.site_id,
            host: result.site_host,
            webhook_secret: result.site_webhook_secret,
            ghost_uuid: result.site_uuid ?? null,
        };

        const account = await this.accountRepository.createFromRow({
            id: result.account_id,
            uuid: result.account_uuid,
            username: result.account_username,
            name: result.account_name,
            bio: result.account_bio,
            url: result.account_url,
            avatar_url: result.account_avatar_url,
            banner_image_url: result.account_banner_image_url,
            ap_id: result.account_ap_id,
            ap_followers_url: result.account_ap_followers_url,
            ap_inbox_url: result.account_ap_inbox_url,
            ap_outbox_url: result.account_ap_outbox_url,
            ap_following_url: result.account_ap_following_url,
            ap_liked_url: result.account_ap_liked_url,
            custom_fields: result.account_custom_fields,
            site_id: result.site_id,
        });

        return ok({
            site,
            account,
        });
    }
}
