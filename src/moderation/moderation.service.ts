import type { Knex } from 'knex';

import type { Post } from '@/post/post.entity';

export class ModerationService {
    constructor(private readonly db: Knex) {}

    async filterUsersForPost(
        userIds: number[],
        post: Post,
        interactionAccountId?: number,
    ): Promise<number[]> {
        // Map user ids to their corresponding account ids
        const userAccountMap = new Map<number, number>();

        const rows = await this.db('users')
            .whereIn('id', userIds)
            .select('id', 'account_id');

        for (const row of rows) {
            userAccountMap.set(row.id, row.account_id);
        }

        // If the post has been interacted with by an account (liked, reposted
        // etc), check if the interaction account has been blocked by the post
        // author, and if so, filter out everybody but the interaction account
        if (interactionAccountId) {
            const block = await this.db('blocks')
                .innerJoin('users', 'blocks.blocked_id', 'users.account_id')
                .where('blocker_id', post.author.id)
                .andWhere('blocked_id', interactionAccountId)
                .select('users.id as blocked_user_id')
                .first();

            if (block) {
                return [block.blocked_user_id];
            }

            const domainBlock = await this.db('domain_blocks')
                .join(
                    'accounts',
                    'domain_blocks.domain_hash',
                    'accounts.domain_hash',
                )
                .innerJoin('users', 'accounts.id', 'users.account_id')
                .where({
                    'domain_blocks.blocker_id': post.author.id,
                    'accounts.id': interactionAccountId,
                })
                .select('users.id as blocked_user_id')
                .first();

            if (domainBlock) {
                return [domainBlock.blocked_user_id];
            }
        }

        const userBlocks = await this.db('blocks')
            .whereIn('blocker_id', Array.from(userAccountMap.values()))
            .andWhere(
                'blocked_id',
                'in',
                [interactionAccountId, post.author.id].filter(
                    (id) => id !== undefined,
                ),
            )
            .select('blocker_id');

        const domainBlocks = await this.db('domain_blocks')
            .join(
                'accounts',
                'domain_blocks.domain_hash',
                'accounts.domain_hash',
            )
            .whereIn('blocker_id', Array.from(userAccountMap.values()))
            .whereIn(
                'accounts.id',
                [interactionAccountId, post.author.id].filter(
                    (id) => id !== undefined,
                ),
            )
            .select('blocker_id');

        // Filter out accounts that have either blocked the author or the
        // interaction account
        const accountIdsToBeFilteredOut = userBlocks
            .concat(domainBlocks)
            .map((row) => row.blocker_id);

        // Of the users provided, filter out the ones that do not have an account
        // that has blocked the author or the interaction account
        return userIds.filter((userId) => {
            const accountId = userAccountMap.get(userId);

            return !accountIdsToBeFilteredOut.includes(accountId);
        });
    }

    async canInteractWithAccount(
        interactionAccountId: number,
        targetAccountId: number,
    ): Promise<boolean> {
        const accountBlock = await this.db('blocks')
            .where('blocker_id', targetAccountId)
            .andWhere('blocked_id', interactionAccountId)
            .first();

        if (accountBlock !== undefined) {
            return false;
        }

        const domainBlock = await this.db('domain_blocks')
            .join(
                'accounts',
                'domain_blocks.domain_hash',
                'accounts.domain_hash',
            )
            .where({
                'domain_blocks.blocker_id': targetAccountId,
                'accounts.id': interactionAccountId,
            })
            .first();

        return domainBlock === undefined;
    }

    async getBlockedDomains(accountId: number): Promise<Set<string>> {
        const blocks = await this.db('domain_blocks')
            .where('blocker_id', accountId)
            .select('domain');

        return new Set(blocks.map((block) => block.domain.toLowerCase()));
    }
}
