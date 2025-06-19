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
}

export function getFullTopic(projectId: string, topic: string) {
    return `projects/${projectId}/topics/${topic}`;
}

export function initPubSubClient({
    host,
    isEmulator,
    projectId,
}: InitClientConfig) {
    return new PubSub({
        apiEndpoint: host,
        emulatorMode: isEmulator,
        projectId,
    });
}
