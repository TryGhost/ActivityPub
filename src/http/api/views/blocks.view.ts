import type { Knex } from 'knex';

import { getAccountHandle } from '@/account/utils';
import type { BlockedDomainDTO, MinimalAccountDTO } from '@/http/api/types';
import { domainBlockMatchesAccount } from '@/moderation/domain-blocks';

export class BlocksView {
    constructor(private readonly db: Knex) {}

    async getBlockedAccounts(accountId: number): Promise<MinimalAccountDTO[]> {
        const db = this.db;

        // An account can match a block under either of its hosts, so this has
        // to ask whether any such block exists rather than join to them. A
        // join fans out into one row per matching block, duplicating the
        // account for a viewer who blocked both of its domains.
        const domainBlockExists = db('domain_blocks')
            .select(db.raw('1'))
            .where('domain_blocks.blocker_id', accountId)
            .where(domainBlockMatchesAccount(db));

        const results = await db('blocks')
            .select([
                'accounts.ap_id',
                'accounts.name',
                'accounts.username',
                'accounts.avatar_url',
            ])
            .select(
                db.raw(
                    'COALESCE(accounts.webfinger_host, accounts.domain) as domain',
                ),
                db.raw('EXISTS (?) as domain_blocked_by_me', [
                    domainBlockExists,
                ]),
            )
            .innerJoin('accounts', 'accounts.id', 'blocks.blocked_id')
            .where('blocks.blocker_id', accountId);

        return results.map((result) => ({
            id: result.ap_id,
            apId: result.ap_id,
            name: result.name || '',
            handle: getAccountHandle(result.domain, result.username),
            avatarUrl: result.avatar_url || null,
            followedByMe: false,
            blockedByMe: true,
            domainBlockedByMe: !!result.domain_blocked_by_me,
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
