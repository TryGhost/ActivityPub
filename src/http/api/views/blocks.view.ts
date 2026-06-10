import type { Knex } from 'knex';

import { getAccountHandle } from '@/account/utils';
import type { BlockedDomainDTO, MinimalAccountDTO } from '@/http/api/types';

export class BlocksView {
    constructor(private readonly db: Knex) {}

    async getBlockedAccounts(accountId: number): Promise<MinimalAccountDTO[]> {
        const effectiveDomainHash = this.db.raw(
            'COALESCE(accounts.webfinger_host_hash, accounts.domain_hash)',
        );

        const results = await this.db('blocks')
            .select([
                'accounts.ap_id',
                'accounts.name',
                'accounts.username',
                'accounts.avatar_url',
                'domain_blocks.domain as blocked_domain',
            ])
            .select(
                this.db.raw(
                    'COALESCE(accounts.webfinger_host, accounts.domain) as domain',
                ),
            )
            .innerJoin('accounts', 'accounts.id', 'blocks.blocked_id')
            .leftJoin('domain_blocks', function () {
                this.on('domain_blocks.domain_hash', effectiveDomainHash);
            })
            .where('blocks.blocker_id', accountId);

        return results.map((result) => ({
            id: result.ap_id,
            apId: result.ap_id,
            name: result.name || '',
            handle: getAccountHandle(result.domain, result.username),
            avatarUrl: result.avatar_url || null,
            followedByMe: false,
            blockedByMe: true,
            domainBlockedByMe: !!result.blocked_domain,
            isFollowing: false,
        }));
    }

    async getBlockedDomains(accountId: number): Promise<BlockedDomainDTO[]> {
        const results = await this.db('domain_blocks')
            .select('domain')
            .where('blocker_id', accountId);

        return results.map((result) => ({
            url: `https://${result.domain}`,
        }));
    }
}
