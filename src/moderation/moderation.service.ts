import type { Knex } from 'knex';

import type { Account } from 'account/account.entity';
import type { PostDTO } from 'http/api/types';

export class ModerationService {
    constructor(private readonly db: Knex) {}

    async filterBlockedPostsForAccount(account: Account, posts: PostDTO[]) {
        if (posts.length === 0) {
            return [];
        }

        const blockedAccountIds = new Set(
            (
                await this.db('blocks')
                    .innerJoin('accounts', 'blocks.blocked_id', 'accounts.id')
                    .select('accounts.ap_id')
                    .where('blocks.blocker_id', account.id)
            ).map((row) => row.ap_id),
        );

        return posts.filter(
            (post) =>
                !blockedAccountIds.has(post.author.id) &&
                (post.repostedBy === null ||
                    !blockedAccountIds.has(post.repostedBy.id)),
        );
    }
}
