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

    // Check that the provided topics exist
    const [existingTopics] = await pubSubClient.getTopics();

    for (const topic of topics) {
        const fullTopic = getFullTopic(pubSubClient.projectId, topic);

        if (!existingTopics.some((t) => t.name === fullTopic)) {
            throw new Error(`Topic [${topic}] does not exist`);
        }
    }

    // Check that the provided subscriptions exist
    const [existingSubscriptions] = await pubSubClient.getSubscriptions();

    for (const subscription of subscriptions) {
        const fullSubscription = `projects/${pubSubClient.projectId}/subscriptions/${subscription}`;

        if (!existingSubscriptions.some((s) => s.name === fullSubscription)) {
            throw new Error(`Subscription [${subscription}] does not exist`);
        }
    }

    return pubSubClient;
}
