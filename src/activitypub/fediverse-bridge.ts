import type EventEmitter from 'node:events';
import { PUBLIC_COLLECTION, Update } from '@fedify/fedify';
import { v4 as uuidv4 } from 'uuid';
import type { Account } from '../account/types';
import type { FedifyContextFactory } from './fedify-context.factory';

export class FediverseBridge {
    constructor(
        private readonly events: EventEmitter,
        private readonly fedifyContextFactory: FedifyContextFactory,
    ) {}

    async init() {
        this.events.on('account.updated', this.handleAccountUpdate.bind(this));
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
}
