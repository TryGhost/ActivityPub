import type { Activity, Recipient } from '@fedify/fedify';
import type { Logger } from '@logtape/logtape';

import type { FedifyContextFactory } from '@/activitypub/fedify-context.factory';

export class ActivitySender {
    constructor(
        private readonly fedifyContextFactory: FedifyContextFactory,
        private readonly logger: Logger,
        private readonly queueEnabled: boolean,
    ) {}

    async sendActivityToFollowers(
        sender: { username: string },
        activity: Activity,
    ): Promise<void> {
        const ctx = this.fedifyContextFactory.getFedifyContext();

        try {
            await ctx.sendActivity(sender, 'followers', activity, {
                preferSharedInbox: true,
            });
        } catch (error) {
            this.logger.error('Failed to send activity: {error}', {
                error,
                activityType: activity.constructor?.name,
                activityId: activity.id?.href,
                recipient: 'followers',
                queueEnabled: this.queueEnabled,
            });
        }
    }

    async sendActivityToRecipient(
        sender: { username: string },
        recipient: Recipient,
        activity: Activity,
    ): Promise<void> {
        const ctx = this.fedifyContextFactory.getFedifyContext();

        try {
            await ctx.sendActivity(sender, recipient, activity);
        } catch (error) {
            this.logger.error('Failed to send activity: {error}', {
                error,
                activityType: activity.constructor?.name,
                activityId: activity.id?.href,
                recipient: recipient.id?.href,
                queueEnabled: this.queueEnabled,
            });
        }
    }
}
