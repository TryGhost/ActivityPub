import type EventEmitter from 'node:events';
import { Delete, PUBLIC_COLLECTION, Update } from '@fedify/fedify';
import { PostDeletedEvent } from 'post/post-deleted.event';
import { v4 as uuidv4 } from 'uuid';
import { AccountUpdatedEvent } from '../account/account-updated.event';
import type { Account } from '../account/types';
import type { FedifyContextFactory } from './fedify-context.factory';

export class FediverseBridge {
    constructor(
        private readonly events: EventEmitter,
        private readonly fedifyContextFactory: FedifyContextFactory,
    ) {}

    async init() {
        this.events.on('account.updated', this.handleAccountUpdate.bind(this));
        this.events.on(
            AccountUpdatedEvent.getName(),
            this.handleAccountUpdatedEvent.bind(this),
        );
        this.events.on(
            PostDeletedEvent.getName(),
            this.handlePostDeleted.bind(this),
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

    private async handleAccountUpdate(account: Account) {
        const ctx = this.fedifyContextFactory.getFedifyContext();

        const update = new Update({
            id: ctx.getObjectUri(Update, { id: uuidv4() }),
            actor: new URL(account.ap_id),
            to: PUBLIC_COLLECTION,
            object: new URL(account.ap_id),
            cc: new URL(account.ap_followers_url),
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
}
