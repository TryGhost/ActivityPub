import { Create, Follow, Note, Undo } from '@fedify/fedify';
import { Temporal } from '@js-temporal/polyfill';
import type { Logger } from '@logtape/logtape';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import type { Account } from '@/account/account.entity';
import type { KnexAccountRepository } from '@/account/account.repository.knex';
import type { AccountService } from '@/account/account.service';
import { AccountFollowedEvent } from '@/account/events';
import type { FedifyContextFactory } from '@/activitypub/fedify-context.factory';
import type { AsyncEvents } from '@/core/events';
import { getValue, isError } from '@/core/result';

/**
 * @see https://fed.brid.gy/docs
 */

export const BRIDGY_AP_ID = new URL('https://bsky.brid.gy/bsky.brid.gy');

export class BlueskyService {
    constructor(
        private readonly db: Knex,
        private readonly accountService: AccountService,
        private readonly accountRepository: KnexAccountRepository,
        private readonly events: AsyncEvents,
        private readonly fedifyContextFactory: FedifyContextFactory,
        private readonly logger: Logger,
    ) {}

    init() {
        this.events.on(
            AccountFollowedEvent.getName(),
            this.handleAccountFollowed.bind(this),
        );
    }

    async enableForAccount(account: Account) {
        if (await this.isEnabledForAccount(account)) {
            this.logger.info(
                `Bluesky integration already enabled for account {id}`,
                { id: account.id },
            );

            return this.getHandleForAccount(account);
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

        return this.getHandleForAccount(account);
    }

    async disableForAccount(account: Account) {
        if (!(await this.isEnabledForAccount(account))) {
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

    private async handleAccountFollowed(event: AccountFollowedEvent) {
        const bridgyAccount = await this.getBridgyAccount();

        if (event.getAccountId() !== bridgyAccount.id) {
            return;
        }

        const followerAccount = await this.accountService.getAccountById(
            event.getFollowerId(),
        );

        if (!followerAccount) {
            this.logger.warn(
                'Could not find account {id} to enable Bluesky integration',
                { id: event.getFollowerId() },
            );

            return;
        }

        // Insert handle → account mapping into the database
        const handle = this.getHandleForAccount(followerAccount);

        await this.db('bluesky_integration_account_handles')
            .insert({
                account_id: followerAccount.id,
                handle,
            })
            .onConflict('account_id')
            .merge();
    }

    private getHandleForAccount(account: Account) {
        return `@${account.username}.${account.apId.hostname}.ap.brid.gy`;
    }

    private async getBridgyAccount() {
        const ensureBridgyAccountResult =
            await this.accountService.ensureByApId(BRIDGY_AP_ID);

        if (isError(ensureBridgyAccountResult)) {
            throw new Error('Failed to retrieve brid.gy account');
        }

        return getValue(ensureBridgyAccountResult);
    }

    private async isEnabledForAccount(account: Account) {
        const result = await this.db('bluesky_integration_account_handles')
            .where('account_id', account.id)
            .first();

        return result !== undefined;
    }
}
