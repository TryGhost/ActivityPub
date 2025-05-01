import type EventEmitter from 'node:events';
import { v4 as uuidv4 } from 'uuid';

import {
    Delete,
    Follow,
    PUBLIC_COLLECTION,
    Reject,
    Update,
} from '@fedify/fedify';
import { AccountBlockedEvent } from 'account/account-blocked.event';
import { PostDeletedEvent } from 'post/post-deleted.event';
import { AccountUpdatedEvent } from '../account/account-updated.event';
import type { AccountService } from '../account/account.service';
import type { FedifyContextFactory } from './fedify-context.factory';

export class FediverseBridge {
    constructor(
        private readonly events: EventEmitter,
        private readonly fedifyContextFactory: FedifyContextFactory,
        private readonly accountService: AccountService,
    ) {}

    async init() {
        this.events.on(
            AccountUpdatedEvent.getName(),
            this.handleAccountUpdatedEvent.bind(this),
        );
        this.events.on(
            PostDeletedEvent.getName(),
            this.handlePostDeleted.bind(this),
        );
        this.events.on(
            AccountBlockedEvent.getName(),
            this.handleAccountBlockedEvent.bind(this),
        );
    }

    private async handlePostDeleted(event: PostDeletedEvent) {
        const post = event.getPost();
        if (!post.author.isInternal) {
            return;
        }
        const ctx = this.fedifyContextFactory.getFedifyContext();
        const deleteActivity = new Delete({
            id: ctx.getObjectUri(Delete, { id: uuidv4() }),
            actor: post.author.apId,
            object: post.apId,
            to: PUBLIC_COLLECTION,
            cc: post.author.apFollowers,
        });

        await ctx.data.globaldb.set(
            [deleteActivity.id!.href],
            await deleteActivity.toJsonLd(),
        );

        await ctx.sendActivity(
            {
                handle: post.author.username,
            },
            'followers',
            deleteActivity,
            {
                preferSharedInbox: true,
            },
        );
    }

    private async handleAccountUpdatedEvent(event: AccountUpdatedEvent) {
        const account = event.getAccount();
        if (!account.isInternal) {
            return;
        }

        const ctx = this.fedifyContextFactory.getFedifyContext();

        const update = new Update({
            id: ctx.getObjectUri(Update, { id: uuidv4() }),
            actor: account.apId,
            to: PUBLIC_COLLECTION,
            object: account.apId,
            cc: account.apFollowers,
        });

        await ctx.data.globaldb.set([update.id!.href], await update.toJsonLd());

        await ctx.sendActivity(
            {
                handle: account.username,
            },
            'followers',
            update,
            {
                preferSharedInbox: true,
            },
        );
    }

    private async handleAccountBlockedEvent(event: AccountBlockedEvent) {
        const ctx = this.fedifyContextFactory.getFedifyContext();

        const blockerAccount = await this.accountService.getAccountById(
            event.getBlockerId(),
        );
        const blockedAccount = await this.accountService.getAccountById(
            event.getAccountId(),
        );

        if (!blockerAccount || !blockedAccount) {
            return;
        }

        if (blockedAccount.isInternal) {
            return;
        }

        const reject = new Reject({
            id: ctx.getObjectUri(Reject, { id: uuidv4() }),
            actor: blockerAccount.apId,
            object: new Follow({
                id: ctx.getObjectUri(Follow, { id: uuidv4() }),
                actor: blockedAccount.apId,
                object: blockerAccount.apId,
            }),
        });

        await ctx.data.globaldb.set([reject.id!.href], await reject.toJsonLd());

        await ctx.sendActivity(
            { username: blockerAccount.username },
            {
                id: blockedAccount.apId,
                inboxId: blockedAccount.apInbox,
            },
            reject,
        );
    }
}
