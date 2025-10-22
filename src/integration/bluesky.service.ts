import { Create, Follow, Note, Undo } from '@fedify/fedify';
import { Temporal } from '@js-temporal/polyfill';
import type { Logger } from '@logtape/logtape';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import type { Account } from '@/account/account.entity';
import type { KnexAccountRepository } from '@/account/account.repository.knex';
import type { AccountService } from '@/account/account.service';
import type { FedifyContextFactory } from '@/activitypub/fedify-context.factory';
import {
    error,
    getError,
    getValue,
    isError,
    ok,
    type Result,
} from '@/core/result';
import { findValidBridgyHandle } from '@/integration/bluesky.utils';
import type {
    BlueskyApiClient,
    BlueskyApiError,
} from '@/integration/bluesky-api.client';

/**
 * @see https://fed.brid.gy/docs
 */

export const BRIDGY_AP_ID = new URL('https://bsky.brid.gy/bsky.brid.gy');

export class BlueskyService {
    constructor(
        private readonly db: Knex,
        private readonly accountService: AccountService,
        private readonly accountRepository: KnexAccountRepository,
        private readonly fedifyContextFactory: FedifyContextFactory,
        private readonly logger: Logger,
        private readonly blueskyApiClient: BlueskyApiClient,
    ) {}

    async enableForAccount(account: Account): Promise<{
        enabled: boolean;
        handleConfirmed: boolean;
        handle: string | null;
    }> {
        const existing = await this.db('bluesky_integration_account_handles')
            .where('account_id', account.id)
            .first();

        if (existing) {
            this.logger.info(
                `Bluesky integration already enabled for account {id}`,
                { id: account.id },
            );

            return {
                enabled: true,
                handleConfirmed: existing.confirmed || false,
                handle: existing.handle || null,
            };
        }

        const bridgyAccount = await this.getBridgyAccount();

        // Send follow request to brid.gy account
        const ctx = this.fedifyContextFactory.getFedifyContext();

        const followId = ctx.getObjectUri(Follow, { id: uuidv4() });

        const follow = new Follow({
            id: followId,
            actor: account.apId,
            object: bridgyAccount.apId,
        });

        await ctx.data.globaldb.set([follow.id!.href], await follow.toJsonLd());

        await ctx.sendActivity(
            { username: account.username },
            {
                id: bridgyAccount.apId,
                inboxId: bridgyAccount.apInbox,
            },
            follow,
        );

        // Insert handle → account mapping into the database - handle is null
        // and confirmed is false until manual confirmation has occurred (see
        // `confirmHandleForAccount`)
        await this.db('bluesky_integration_account_handles')
            .insert({
                account_id: account.id,
                handle: null,
                confirmed: false,
            })
            .onConflict('account_id')
            .merge();

        return {
            enabled: true,
            handleConfirmed: false,
            handle: null,
        };
    }

    async disableForAccount(account: Account) {
        const existing = await this.db('bluesky_integration_account_handles')
            .where('account_id', account.id)
            .first();

        if (!existing) {
            this.logger.info(
                `Bluesky integration already disabled for account {id}`,
                { id: account.id },
            );

            return;
        }

        const bridgyAccount = await this.getBridgyAccount();

        const ctx = this.fedifyContextFactory.getFedifyContext();

        // Send "stop" dm to brid.gy account
        const note = new Note({
            id: ctx.getObjectUri(Note, { id: uuidv4() }),
            attribution: account.apId,
            content: 'stop',
            published: Temporal.Now.instant(),
            to: bridgyAccount.apId,
        });

        const create = new Create({
            id: ctx.getObjectUri(Create, { id: uuidv4() }),
            actor: account.apId,
            object: note,
            to: bridgyAccount.apId,
        });

        await ctx.data.globaldb.set([note.id!.href], await note.toJsonLd());
        await ctx.data.globaldb.set([create.id!.href], await create.toJsonLd());

        await ctx.sendActivity(
            { username: account.username },
            {
                id: bridgyAccount.apId,
                inboxId: bridgyAccount.apInbox,
            },
            create,
        );

        // Unfollow brid.gy account
        await this.accountRepository.save(account.unfollow(bridgyAccount));

        const follow = new Follow({
            id: null,
            actor: account.apId,
            object: bridgyAccount.apId,
        });

        const undoId = ctx.getObjectUri(Undo, { id: uuidv4() });

        const undo = new Undo({
            id: undoId,
            actor: account.apId,
            object: follow,
        });

        await ctx.data.globaldb.set([undo.id!.href], await undo.toJsonLd());

        await ctx.sendActivity(
            { username: account.username },
            {
                id: bridgyAccount.apId,
                inboxId: bridgyAccount.apInbox,
            },
            undo,
        );

        // Delete handle → account mapping from the database
        await this.db('bluesky_integration_account_handles')
            .where('account_id', account.id)
            .delete();
    }

    async confirmHandleForAccount(
        account: Account,
    ): Promise<
        Result<
            { handleConfirmed: boolean; handle: string | null },
            BlueskyApiError | { type: 'not-enabled' }
        >
    > {
        const existing = await this.db('bluesky_integration_account_handles')
            .where('account_id', account.id)
            .first();

        if (!existing) {
            this.logger.debug(
                'Bluesky integration not enabled for account {id}',
                { id: account.id },
            );

            return error({ type: 'not-enabled' });
        }

        // If already confirmed, return existing handle
        if (existing.confirmed && existing.handle) {
            this.logger.debug(
                'Bluesky handle already confirmed for account {id}',
                { id: account.id, handle: existing.handle },
            );

            return ok({
                handleConfirmed: true,
                handle: existing.handle,
            });
        }

        // Query Bluesky API to find the handle
        const domain = account.apId.hostname;
        const result = await this.blueskyApiClient.searchActors(domain);

        if (isError(result)) {
            this.logger.warn('Failed to search Bluesky for account {id}', {
                id: account.id,
                error: getError(result),
            });

            return result;
        }

        const actors = getValue(result);

        // Find a valid Bridgy Fed handle from the search results
        const handle = findValidBridgyHandle(actors, domain);

        if (!handle) {
            this.logger.info(
                'Bluesky handle not yet available for account {id}',
                {
                    id: account.id,
                    domain,
                },
            );

            return ok({
                handleConfirmed: false,
                handle: null,
            });
        }

        // Update the database with the confirmed handle
        await this.db('bluesky_integration_account_handles')
            .where('account_id', account.id)
            .update({
                handle,
                confirmed: true,
            });

        return ok({
            handleConfirmed: true,
            handle,
        });
    }

    private async getBridgyAccount() {
        const ensureBridgyAccountResult =
            await this.accountService.ensureByApId(BRIDGY_AP_ID);

        if (isError(ensureBridgyAccountResult)) {
            throw new Error('Failed to retrieve brid.gy account');
        }

        return getValue(ensureBridgyAccountResult);
    }
}
