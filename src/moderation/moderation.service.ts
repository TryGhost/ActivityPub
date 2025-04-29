import type { Account } from 'account/account.entity';
import type { PostDTO } from 'http/api/types';
import type { Knex } from 'knex';
import type { Post } from 'post/post.entity';

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
        }

        // Filter out accounts that have either blocked the author or the
        // interaction account
        const accountIdsToBeFilteredOut = (
            await this.db('blocks')
                .whereIn('blocker_id', Array.from(userAccountMap.values()))
                .andWhere(
                    'blocked_id',
                    'in',
                    [interactionAccountId, post.author.id].filter(
                        (id) => id !== undefined,
                    ),
                )
                .select('blocker_id')
        ).map((row) => row.blocker_id);

        // Of the users provided, filter out the ones that do not have an account
        // that has blocked the author or the interaction account
        return userIds.filter((userId) => {
            const accountId = userAccountMap.get(userId);

            return !accountIdsToBeFilteredOut.includes(accountId);
        });
    }

    async filterUsersForAccountInteraction(
        userIds: number[],
        interactionAccountId: number,
    ): Promise<number[]> {
        // Map user ids to their corresponding account ids
        const userAccountMap = new Map<number, number>();

        const rows = await this.db('users')
            .whereIn('id', userIds)
            .select('id', 'account_id');

        for (const row of rows) {
            userAccountMap.set(row.id, row.account_id);
        }

        // Filter out accounts that have blocked the interaction account
        const accountIdsToBeFilteredOut = (
            await this.db('blocks')
                .whereIn('blocker_id', Array.from(userAccountMap.values()))
                .andWhere('blocked_id', interactionAccountId)
                .select('blocker_id')
        ).map((row) => row.blocker_id);

        // Of the users provided, filter out the ones that do not have an account
        // that has blocked the interaction account
        return userIds.filter((userId) => {
            const accountId = userAccountMap.get(userId);

            return !accountIdsToBeFilteredOut.includes(accountId);
        });
    }
}
