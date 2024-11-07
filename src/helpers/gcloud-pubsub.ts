import type { PubSub } from '@google-cloud/pubsub';

export function getFullTopicIdentifier(
    client: PubSub,
    topicIdentifier: string,
) {
    return `projects/${client.projectId}/topics/${topicIdentifier}`;
}

export async function topicExists(client: PubSub, topicIdentifier: string) {
    const [topics] = await client.getTopics();

    return topics.some((topic) => topic.name === topicIdentifier);
}

export function getFullSubscriptionIdentifier(
    client: PubSub,
    subscriptionIdentifier: string,
) {
    return `projects/${client.projectId}/subscriptions/${subscriptionIdentifier}`;
}

export async function subscriptionExists(
    client: PubSub,
    subscriptionIdentifier: string,
) {
    const [subscriptions] = await client.getSubscriptions();

    return subscriptions.some(
        (subscription) => subscription.name === subscriptionIdentifier,
    );
}
