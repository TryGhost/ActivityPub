import type { EventEmitter } from 'node:events';
import { PubSub } from '@google-cloud/pubsub';
import type { Logger } from '@logtape/logtape';

import { GCloudPubSubMessageQueue } from '../mq/gcloud-pubsub-mq';

export function getFullTopicIdentifier(
    projectId: string,
    topicIdentifier: string,
) {
    return `projects/${projectId}/topics/${topicIdentifier}`;
}

export async function topicExists(client: PubSub, topicIdentifier: string) {
    const [topics] = await client.getTopics();

    return topics.some((topic) => topic.name === topicIdentifier);
}

export function getFullSubscriptionIdentifier(
    projectId: string,
    subscriptionIdentifier: string,
) {
    return `projects/${projectId}/subscriptions/${subscriptionIdentifier}`;
}

async function subscriptionExists(
    client: PubSub,
    subscriptionIdentifier: string,
) {
    const [subscriptions] = await client.getSubscriptions();

    return subscriptions.some(
        (subscription) => subscription.name === subscriptionIdentifier,
    );
}

type InitGCloudPubSubMessageQueueOptions = {
    host: string;
    emulatorMode: boolean;
    projectId: string;
    topicName: string;
    subscriptionName: string;
};

export async function initGCloudPubSubMessageQueue(
    logger: Logger,
    eventBus: EventEmitter,
    messageReceivedEventName: string,
    {
        host,
        emulatorMode,
        projectId,
        topicName = 'unknown_topic',
        subscriptionName = 'unknown_subscription',
    }: InitGCloudPubSubMessageQueueOptions,
) {
    const pubSubClient = new PubSub({
        projectId,
        apiEndpoint: host,
        emulatorMode,
    });

    const topicIdentifier = getFullTopicIdentifier(projectId, topicName);
    const subscriptionIdentifier = getFullSubscriptionIdentifier(
        projectId,
        subscriptionName,
    );

    if (!(await topicExists(pubSubClient, topicIdentifier))) {
        throw new Error(`Topic does not exist: ${topicName}`);
    }

    if (!(await subscriptionExists(pubSubClient, subscriptionIdentifier))) {
        throw new Error(`Subscription does not exist: ${subscriptionName}`);
    }

    return new GCloudPubSubMessageQueue(
        pubSubClient,
        eventBus,
        logger,
        topicIdentifier,
        subscriptionIdentifier,
        messageReceivedEventName,
    );
}
