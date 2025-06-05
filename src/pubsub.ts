import { PubSub } from '@google-cloud/pubsub';

interface InitClientConfig {
    /**
     * Hostname of the Pub/Sub API endpoint
     */
    host: string;
    /**
     * Indicates that a Pub/Sub emulator is being used or not
     */
    isEmulator: boolean;
    /**
     * ID of the Pub/Sub project
     */
    projectId: string;
    /**
     * Array of Pub/Sub topics to publish messages to
     */
    topics: string[];
    /**
     * Array of Pub/Sub subscriptions to receive messages from
     */
    subscriptions: string[];
}

export function getFullTopic(projectId: string, topic: string) {
    return `projects/${projectId}/topics/${topic}`;
}

async function checkTopicExists(pubSubClient: PubSub, topic: string) {
    const fullTopic = getFullTopic(pubSubClient.projectId, topic);

    const [topics] = await pubSubClient.getTopics();

    return topics.some(({ name }) => name === fullTopic);
}

async function checkSubscriptionExists(
    pubSubClient: PubSub,
    subscription: string,
) {
    const fullSubscription = `projects/${pubSubClient.projectId}/subscriptions/${subscription}`;

    const [subscriptions] = await pubSubClient.getSubscriptions();

    return subscriptions.some(({ name }) => name === fullSubscription);
}

export async function initPubSubClient({
    host,
    isEmulator,
    projectId,
    topics,
    subscriptions,
}: InitClientConfig) {
    // Initialise the Pub/Sub client
    const pubSubClient = new PubSub({
        apiEndpoint: host,
        emulatorMode: isEmulator,
        projectId,
    });

    // Check that the provided topics exists
    for (const topic of topics) {
        if (!(await checkTopicExists(pubSubClient, topic))) {
            throw new Error(`Topic [${topic}] does not exist`);
        }
    }

    // Check that the provided subscriptions exist
    for (const subscription of subscriptions) {
        if (!(await checkSubscriptionExists(pubSubClient, subscription))) {
            throw new Error(`Subscription [${subscription}] does not exist`);
        }
    }

    return pubSubClient;
}
