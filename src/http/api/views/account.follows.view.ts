import { createHash } from 'node:crypto';

import {
    type Actor,
    CollectionPage,
    type DocumentLoader,
    isActor,
    lookupObject,
} from '@fedify/fedify';
import type { Knex } from 'knex';

import type { Account } from '@/account/account.entity';
import { getAccountHandle } from '@/account/utils';
import type { FedifyContextFactory } from '@/activitypub/fedify-context.factory';
import { error, getValue, isError, ok, type Result } from '@/core/result';
import type { MinimalAccountDTO } from '@/http/api/types';
import type { ModerationService } from '@/moderation/moderation.service';

/**
 * Maximum number of follow accounts to return
 */
const FOLLOWS_LIMIT = 20;

export type GetFollowsError =
    | 'invalid-next-parameter'
    | 'error-getting-follows'
    | 'not-an-actor';

export interface AccountFollows {
    accounts: MinimalAccountDTO[];
    next: string | null;
}

interface AccountRow {
    id: number;
    ap_id: string;
    name: string;
    username: string;
    avatar_url: string;
    followed_by_me: number;
    blocked_by_me: number;
}

interface FollowsActor {
    id: string;
    name: string;
    preferredUsername: string;
    icon: {
        url: string;
    };
}

function isValidFollowsActor(obj: unknown): obj is FollowsActor {
    if (!obj || typeof obj !== 'object') {
        return false;
    }

    if (!('id' in obj) || typeof obj.id !== 'string') {
        return false;
    }

    if (!('name' in obj) || typeof obj.name !== 'string') {
        return false;
    }

    if (
        !('preferredUsername' in obj) ||
        typeof obj.preferredUsername !== 'string'
    ) {
        return false;
    }

    if (
        !('icon' in obj) ||
        !obj.icon ||
        typeof obj.icon !== 'object' ||
        !('url' in obj.icon) ||
        typeof obj.icon.url !== 'string'
    ) {
        return false;
    }

    return true;
}

export class AccountFollowsView {
    constructor(
        private readonly db: Knex,
        private readonly fedifyContextFactory: FedifyContextFactory,
        private readonly moderationService: ModerationService,
    ) {}

    async getFollowsByAccount(
        account: Account,
        type: string,
        next: number,
        siteDefaultAccount: Account,
    ): Promise<AccountFollows> {
        const getAccounts =
            type === 'following'
                ? this.getFollowingAccounts.bind(this)
                : this.getFollowerAccounts.bind(this);
        const getAccountsCount =
            type === 'following'
                ? this.getFollowingAccountsCount.bind(this)
                : this.getFollowerAccountsCount.bind(this);

        const results = await getAccounts(
            account.id,
            siteDefaultAccount.id,
            FOLLOWS_LIMIT,
            next,
        );
        const total = await getAccountsCount(account.id);

        const nextCursor =
            total > next + FOLLOWS_LIMIT
                ? (next + FOLLOWS_LIMIT).toString()
                : null;

        const blockedDomains = await this.moderationService.getBlockedDomains(
            siteDefaultAccount.id,
        );

        const accounts: MinimalAccountDTO[] = [];

        for (const result of results) {
            const apIdUrl = new URL(result.ap_id);

            accounts.push({
                id: result.ap_id,
                apId: result.ap_id,
                name: result.name || '',
                handle: getAccountHandle(apIdUrl.host, result.username),
                avatarUrl: result.avatar_url || '',
                isFollowing: !!result.followed_by_me,
                followedByMe: !!result.followed_by_me,
                blockedByMe: !!result.blocked_by_me,
                domainBlockedByMe: blockedDomains.has(apIdUrl.hostname),
            });
        }

        return {
            accounts: accounts,
            next: nextCursor,
        };
    }

    private async getRemoteFollowsPage(
        actor: Actor,
        next: URL,
        documentLoader: DocumentLoader,
    ): Promise<Result<CollectionPage, GetFollowsError>> {
        let page: CollectionPage | null = null;

        try {
            // Ensure the next parameter is for the same host as the actor. We
            // do this to prevent blindly passing URIs to lookupObject (i.e next
            // param has been tampered with)
            const { host: actorHost } = actor?.id || new URL('');
            const { host: nextHost } = next;

            if (actorHost !== nextHost) {
                return error('invalid-next-parameter');
            }

            page = (await lookupObject(next, {
                documentLoader,
            })) as CollectionPage | null;

            // Check that we have a valid page
            if (!(page instanceof CollectionPage) || !page?.itemIds) {
                return error('error-getting-follows');
            }
        } catch (_err) {
            return error('error-getting-follows');
        }

        return ok(page);
    }

    private async getUnpaginatedFollows(
        actor: Actor,
        type: string,
        next: number,
        siteDefaultAccount: Account,
    ): Promise<Result<AccountFollows, GetFollowsError>> {
        const follows =
            type === 'following'
                ? await actor.getFollowing()
                : await actor.getFollowers();

        if (!follows || !follows.itemIds || follows.itemIds.length === 0) {
            return error('error-getting-follows');
        }

        const pageSize = FOLLOWS_LIMIT;
        const pageNumber = next;
        const startIndex = (pageNumber - 1) * pageSize;

        const pageUrls = follows.itemIds.slice(
            startIndex,
            startIndex + pageSize,
        );

        const accounts = await this.processFollowsList(
            pageUrls,
            siteDefaultAccount,
        );

        let nextCursor = null;

        if (follows.totalItems && pageNumber * pageSize < follows.totalItems) {
            nextCursor = (pageNumber + 1).toString();
        }

        return ok({
            accounts: accounts,
            next: nextCursor,
        });
    }

    async getFollowsByRemoteLookUp(
        apId: URL,
        next: string,
        type: string,
        siteDefaultAccount: Account,
    ): Promise<Result<AccountFollows, GetFollowsError>> {
        const ctx = this.fedifyContextFactory.getFedifyContext();

        const documentLoader = await ctx.getDocumentLoader({
            handle: 'index',
        });

        // Lookup actor by handle
        const actor = await lookupObject(apId, { documentLoader });

        if (!isActor(actor)) {
            return error('not-an-actor');
        }

        // If next is a number, it's an unpaginated request
        if (Number(next)) {
            return this.getUnpaginatedFollows(
                actor,
                type,
                Number.parseInt(next, 10),
                siteDefaultAccount,
            );
        }

        let page: CollectionPage | null = null;

        // If next is an empty string, get the first page
        try {
            if (next === '') {
                const follows =
                    type === 'following'
                        ? await actor.getFollowing()
                        : await actor.getFollowers();

                page = follows ? await follows.getFirst() : null;
                if (!page) {
                    return this.getUnpaginatedFollows(
                        actor,
                        type,
                        1,
                        siteDefaultAccount,
                    );
                }
            } else {
                // Handle subsequent pages
                const pageResult = await this.getRemoteFollowsPage(
                    actor,
                    new URL(next),
                    documentLoader,
                );

                if (isError(pageResult)) {
                    return pageResult;
                }

                page = getValue(pageResult);
            }
        } catch (_err) {
            return error('error-getting-follows');
        }

        const accounts = await this.processFollowsList(
            page.itemIds,
            siteDefaultAccount,
        );

        const nextCursor = page.nextId
            ? encodeURIComponent(page.nextId.toString())
            : null;

        return ok({
            accounts: accounts,
            next: nextCursor,
        });
    }

    private async processFollowsList(
        followsList: URL[],
        siteDefaultAccount: Account,
    ): Promise<MinimalAccountDTO[]> {
        const ctx = this.fedifyContextFactory.getFedifyContext();
        const documentLoader = await ctx.getDocumentLoader({
            handle: 'index',
        });
        const accounts: MinimalAccountDTO[] = [];

        const followsHrefs = followsList.map((item) => item.href);
        if (followsHrefs.length === 0) {
            return [];
        }

        const accountsData = await this.db('accounts')
            .select('accounts.*')
            .select(
                this.db.raw(`
                    CASE
                        WHEN follows.follower_id IS NOT NULL THEN 1
                        ELSE 0
                    END AS followed_by_me
                `),
                this.db.raw(`
                    CASE
                        WHEN blocks.blocker_id IS NOT NULL THEN 1
                        ELSE 0
                    END AS blocked_by_me
                `),
            )
            .leftJoin('follows', function () {
                this.on('follows.following_id', '=', 'accounts.id').andOnVal(
                    'follows.follower_id',
                    '=',
                    siteDefaultAccount.id,
                );
            })
            .leftJoin('blocks', function () {
                this.on('blocks.blocked_id', '=', 'accounts.id').andOnVal(
                    'blocks.blocker_id',
                    '=',
                    siteDefaultAccount.id,
                );
            })
            .whereRaw(
                `accounts.ap_id_hash IN (${followsHrefs.map(() => 'UNHEX(SHA2(?, 256))').join(', ')})`,
                followsHrefs,
            );

        const accountsMap = new Map(
            accountsData.map((acc) => [
                Buffer.from(acc.ap_id_hash).toString('hex'),
                acc,
            ]),
        );

        const blockedDomains = await this.moderationService.getBlockedDomains(
            siteDefaultAccount.id,
        );

        for await (const item of followsList) {
            try {
                const followeeAccount = accountsMap.get(
                    createHash('sha256').update(item.href).digest('hex'),
                );

                if (followeeAccount) {
                    const apIdUrl = new URL(followeeAccount.ap_id);

                    accounts.push({
                        id: followeeAccount.ap_id,
                        apId: followeeAccount.ap_id,
                        name: followeeAccount.name || '',
                        handle: getAccountHandle(
                            apIdUrl.host,
                            followeeAccount.username,
                        ),
                        avatarUrl: followeeAccount.avatar_url || '',
                        isFollowing: !!followeeAccount.followed_by_me,
                        followedByMe: !!followeeAccount.followed_by_me,
                        blockedByMe: !!followeeAccount.blocked_by_me,
                        domainBlockedByMe: blockedDomains.has(apIdUrl.hostname),
                    });
                } else {
                    const followsActorObj = await lookupObject(item.href, {
                        documentLoader,
                    });

                    if (!isActor(followsActorObj)) {
                        continue;
                    }

                    const followsActor = (await followsActorObj.toJsonLd({
                        format: 'compact',
                    })) as unknown;

                    if (!isValidFollowsActor(followsActor)) {
                        continue;
                    }

                    accounts.push({
                        id: followsActor.id,
                        apId: followsActor.id,
                        name: followsActor.name,
                        handle: getAccountHandle(
                            new URL(followsActor.id).host,
                            followsActor.preferredUsername,
                        ),
                        avatarUrl: followsActor.icon.url,
                        isFollowing: false,
                        followedByMe: false,
                        blockedByMe: false,
                        domainBlockedByMe: blockedDomains.has(item.hostname),
                    });
                }
            } catch (_err) {
                ctx.data.logger.error('Error while iterating over follow list');
                // Skip this item if processing fails
                // This ensures that a single invalid or unreachable follow doesn't block the API from returning valid follows
                // If fetching any one follow fails, we can still return the other valid follows in the collection
            }
        }

        return accounts;
    }

    private async getFollowingAccountsCount(
        accountId: number,
    ): Promise<number> {
        const result = await this.db('follows')
            .where('follower_id', accountId)
            .count('*', { as: 'count' });

        return Number(result[0].count);
    }

    private async getFollowerAccountsCount(accountId: number): Promise<number> {
        const result = await this.db('follows')
            .where('following_id', accountId)
            .count('*', { as: 'count' });

        return Number(result[0].count);
    }

    private async getFollowerAccounts(
        accountId: number,
        contextAccountId: number,
        limit: number,
        offset: number,
    ): Promise<AccountRow[]> {
        return await this.db('follows')
            .select([
                'accounts.id',
                'accounts.ap_id',
                'accounts.name',
                'accounts.username',
                'accounts.avatar_url',
            ])
            .select(
                this.db.raw(`
                    CASE
                        WHEN f2.follower_id IS NOT NULL THEN 1
                        ELSE 0
                    END AS followed_by_me
                `),
            )
            .select(
                this.db.raw(`
                    CASE
                        WHEN b.blocker_id IS NOT NULL THEN 1
                        ELSE 0
                    END AS blocked_by_me
                `),
            )
            .where('follows.following_id', accountId)
            .innerJoin('accounts', 'accounts.id', 'follows.follower_id')
            .leftJoin({ f2: 'follows' }, function () {
                this.on('f2.following_id', '=', 'accounts.id').andOnVal(
                    'f2.follower_id',
                    '=',
                    contextAccountId,
                );
            })
            .leftJoin({ b: 'blocks' }, function () {
                this.on('b.blocked_id', '=', 'accounts.id').andOnVal(
                    'b.blocker_id',
                    '=',
                    contextAccountId,
                );
            })
            .limit(limit)
            .offset(offset)
            // order by the date created at in descending order and then by the
            // account id in descending order to ensure the most recent follows
            // are returned first (i.e in case multiple follows were created at
            // the same time)
            .orderBy('follows.created_at', 'desc')
            .orderBy('accounts.id', 'desc');
    }

    private async getFollowingAccounts(
        accountId: number,
        contextAccountId: number,
        limit: number,
        offset: number,
    ): Promise<AccountRow[]> {
        return await this.db('follows')
            .select([
                'accounts.id',
                'accounts.ap_id',
                'accounts.name',
                'accounts.username',
                'accounts.avatar_url',
            ])
            .select(
                this.db.raw(`
                    CASE
                        WHEN f2.follower_id IS NOT NULL THEN 1
                        ELSE 0
                    END AS followed_by_me
                `),
            )
            .select(
                this.db.raw(`
                    CASE
                        WHEN b.blocker_id IS NOT NULL THEN 1
                        ELSE 0
                    END AS blocked_by_me
                `),
            )
            .where('follows.follower_id', accountId)
            .innerJoin('accounts', 'accounts.id', 'follows.following_id')
            .leftJoin({ f2: 'follows' }, function () {
                this.on('f2.following_id', '=', 'accounts.id').andOnVal(
                    'f2.follower_id',
                    '=',
                    contextAccountId,
                );
            })
            .leftJoin({ b: 'blocks' }, function () {
                this.on('b.blocked_id', '=', 'accounts.id').andOnVal(
                    'b.blocker_id',
                    '=',
                    contextAccountId,
                );
            })
            .limit(limit)
            .offset(offset)
            // order by the date created at in descending order and then by the
            // account id in descending order to ensure the most recent follows
            // are returned first (i.e in case multiple follows were created at
            // the same time)
            .orderBy('follows.created_at', 'desc')
            .orderBy('accounts.id', 'desc');
    }
}
