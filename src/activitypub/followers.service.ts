import type { Recipient } from '@fedify/fedify';
import type { Account } from 'account/account.entity';
import { parseURL } from 'core/url';
import type { Knex } from 'knex';

export class FollowersService {
    constructor(private readonly client: Knex) {}
    async getFollowers(accountId: Account['id']): Promise<Recipient[]> {
        const rows: unknown[] = await this.client('follows')
            .select(
                'accounts.ap_id',
                'accounts.ap_inbox_url',
                'accounts.ap_shared_inbox_url',
            )
            .where('follows.following_id', accountId)
            .innerJoin('accounts', 'accounts.id', 'follows.follower_id')
            .orderBy('follows.id', 'desc');

        return rows.reduce(
            (recipients: Recipient[], row: unknown): Recipient[] => {
                if (!row || typeof row !== 'object') {
                    return recipients;
                }
                let id = null;
                if ('ap_id' in row) {
                    id = parseURL(row.ap_id);
                }
                let inboxId = null;
                if ('ap_inbox_url' in row) {
                    inboxId = parseURL(row.ap_inbox_url);
                }
                let sharedInbox = null;
                if ('ap_shared_inbox_url' in row) {
                    sharedInbox = parseURL(row.ap_shared_inbox_url);
                }
                return recipients.concat({
                    id,
                    inboxId,
                    endpoints: {
                        sharedInbox,
                    },
                });
            },
            [],
        );
    }
}
