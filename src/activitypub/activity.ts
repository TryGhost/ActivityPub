import type { Activity, Actor } from '@fedify/fedify';

import type { FedifyRequestContext } from '../app';

/**
 * Sends an ActivityPub activity to Fediverse actors
 *
 * @template TActivity Type of activity to send
 * @template TActor Type of actor to utilise when sending an activity
 */
export interface ActivitySender<TActivity, TActor> {
    /**
     * Send an activity to the followers of an actor
     *
     * @param activity Activity to send
     * @param actor Actor whose followers will receive the activity
     */
    sendActivityToActorFollowers(
        activity: TActivity,
        actor: TActor,
    ): Promise<void>;
}

/**
 * ActivitySender implementation using Fedify's RequestContext
 */
export class FedifyActivitySender implements ActivitySender<Activity, Actor> {
    constructor(private readonly fedifyCtx: FedifyRequestContext) {}

    async sendActivityToActorFollowers(activity: Activity, actor: Actor) {
        await this.fedifyCtx.sendActivity(
            { handle: String(actor.preferredUsername) },
            'followers',
            activity,
            {
                preferSharedInbox: true,
            },
        );
    }
}
