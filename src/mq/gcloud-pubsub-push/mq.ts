import type {
    MessageQueue,
    MessageQueueEnqueueOptions,
    MessageQueueListenOptions,
} from '@fedify/fedify';
import { type ClientConfig, PubSub } from '@google-cloud/pubsub';
import type { Logger } from '@logtape/logtape';
import type { Context } from 'hono';

/**
 * Represents a message from a Pub/Sub push subscription
 */
interface Message {
    /**
     * Unique identifier for the message
     */
    id: string;
    /**
     * Data contained within the message
     */
    data: Record<string, unknown>;
    /**
     * Additional metadata about the message
     */
    attributes: Record<string, string>;
}

/**
 * Helper to get the full name of a Pub/Sub topic
 *
 * @param projectId {string} ID of the Pub/Sub project
 * @param topic {string} Name of the topic
 * @returns {string}
 */
function getFullTopic(projectId: string, topic: string) {
    return `projects/${projectId}/topics/${topic}`;
}

/**
 * Helper to get the full name of a Pub/Sub subscription
 *
 * @param projectId {string} ID of the Pub/Sub project
 * @param subscription {string} Name of the subscription
 * @returns {string}
 */
function getFullSubscription(projectId: string, subscription: string) {
    return `projects/${projectId}/subscriptions/${subscription}`;
}

/**
 * Message queue that utilises GCloud Pub/Sub
 */
export class GCloudPubSubPushMessageQueue implements MessageQueue {
    private logger: Logger;
    private pubSubClient: PubSub;
    private topic: string;
    private messageHandler?: (message: any) => Promise<void> | void;
    private errorListener?: (error: Error) => void;

    /**
     * Creates a new message queue
     *
     * @param logger {Logger} Logger instance
     * @param pubSubClient {PubSub} Pub/Sub client instance
     * @param topic {string} Full name of topic to publish messages to
     */
    constructor(logger: Logger, pubSubClient: PubSub, topic: string) {
        this.logger = logger;
        this.pubSubClient = pubSubClient;
        this.topic = topic;
    }

    /**
     * Indicates whether the message queue is listening for messages or not
     */
    get isListening(): boolean {
        return this.messageHandler !== undefined;
    }

    /**
     * Enqueues a message
     *
     * @param message {any} Message to enqueue
     * @param options {MessageQueueEnqueueOptions} Options for the enqueue operation
     */
    async enqueue(
        message: any,
        options?: MessageQueueEnqueueOptions,
    ): Promise<void> {
        const delay = options?.delay?.total('millisecond');

        // If the message has a delay, do not enqueue it - This is likely a retry
        // attempt by Fedify, but we do not want to retry the message as we want
        // to use GCloud Pub/Sub's built in retry mechanism
        if (delay !== undefined) {
            this.logger.info(
                `Not enqueuing message [FedifyID: ${message.id}] due to delay being set: ${delay}`,
                { fedifyId: message.id },
            );

            return;
        }

        this.logger.info(`Enqueuing message [FedifyID: ${message.id}]`, {
            fedifyId: message.id,
        });

        try {
            const messageId = await this.pubSubClient
                .topic(this.topic)
                .publishMessage({
                    json: message,
                    attributes: {
                        fedifyId: message.id,
                    },
                });

            this.logger.info(
                `Message [FedifyID: ${message.id}] was enqueued [PubSubID: ${messageId}]`,
                { fedifyId: message.id, pubSubId: messageId },
            );
        } catch (error) {
            this.logger.error(
                `Failed to enqueue message [FedifyID: ${message.id}]: ${error}`,
                { fedifyId: message.id, error },
            );

            this.errorListener?.(error as Error);
        }
    }

    /**
     * Starts the message queue
     *
     * @param handler {function} Message handler
     * @param options {MessageQueueListenOptions} Options for the listen operation
     */
    async listen(
        handler: (message: any) => Promise<void> | void,
        options: MessageQueueListenOptions = {},
    ): Promise<void> {
        this.messageHandler = handler;

        return await new Promise((resolve) => {
            options.signal?.addEventListener('abort', () => {
                resolve();
            });
        });
    }

    /**
     * Handles a message
     *
     * @param message {Message} Message to handle
     */
    async handleMessage(message: Message): Promise<void> {
        if (this.messageHandler === undefined) {
            const error = new Error(
                'Message queue is not listening, cannot handle message',
            );

            this.logger.error(
                `Message [FedifyID: ${message.attributes.fedifyId}, PubSubID: ${message.id}] cannot be handled as the message queue is not yet listening`,
                {
                    fedifyId: message.attributes.fedifyId,
                    pubSubId: message.id,
                    error,
                },
            );

            throw error;
        }

        const fedifyId = message.attributes.fedifyId ?? 'unknown';

        this.logger.info(
            `Handling message [FedifyID: ${fedifyId}, PubSubID: ${message.id}]`,
            { fedifyId, pubSubId: message.id },
        );

        try {
            await this.messageHandler(message.data);

            this.logger.info(
                `Acknowledged message [FedifyID: ${fedifyId}, PubSubID: ${message.id}]`,
                { fedifyId, pubSubId: message.id },
            );
        } catch (error) {
            this.logger.error(
                `Failed to handle message [FedifyID: ${fedifyId}, PubSubID: ${message.id}]: ${error}`,
                { fedifyId, pubSubId: message.id, error },
            );

            this.errorListener?.(error as Error);

            throw error;
        }
    }

    /**
     * Registers an error listener
     *
     * @param listener {function}
     */
    registerErrorListener(listener: (error: Error) => void): void {
        this.errorListener = listener;
    }
}

/**
 * Represents an incoming message from a Pub/Sub push subscription
 *
 * @see https://cloud.google.com/pubsub/docs/push#receive_push
 */
interface IncomingPushMessageJson {
    message: {
        /**
         * Unique identifier for the message
         */
        message_id: string;
        /**
         * Data contained within the message encoded as a base64 string
         */
        data: string;
        /**
         * Additional metadata about the message
         */
        attributes: Record<string, string>;
    };
}

/**
 * Hono middleware to handle an incoming message from a Pub/Sub push subscription
 *
 * @param mq {GCloudPubSubPushMessageQueue} Message queue instance
 * @returns {function}
 *
 * @example
 * ```
 * import { createMessageQueue, handlePushMessage } from './mq/gcloud-pubsub-push';
 *
 * const queue = await createMessageQueue(...);
 *
 * app.post('/mq', handlePushMessage(queue));
 * ```
 */
export function handlePushMessage(
    mq: GCloudPubSubPushMessageQueue,
): (ctx: Context) => Promise<Response> {
    return async (ctx: Context) => {
        const json = await ctx.req.json<IncomingPushMessageJson>();

        // Check that the message queue is listening
        if (mq.isListening === false) {
            return new Response(null, { status: 429 });
        }

        let data = {};

        // Attempt to parse the incoming message data
        try {
            data = JSON.parse(
                Buffer.from(json.message.data, 'base64').toString(),
            );
        } catch (error) {
            return new Response(null, { status: 500 });
        }

        // Handle the message
        return mq
            .handleMessage({
                id: json.message.message_id,
                data,
                attributes: json.message.attributes,
            })
            .then(() => new Response(null, { status: 200 }))
            .catch(() => new Response(null, { status: 500 }));
    };
}

export type CreateMessageQueueConfig = {
    /**
     * Hostname of the Pub/Sub API endpoint. If not provided, the the Pub/Sub
     * client will attempt to automatically determine the endpoint
     */
    pubSubHost?: string;
    /**
     * Indicates that a Pub/Sub emulator is being used. If not provided, the
     * Pub/Sub client will automatically determine whether an emulator is being
     * used or not
     */
    hostIsEmulator?: boolean;
    /**
     * ID of the Pub/Sub project. If not provided, the Pub/Sub client will
     * attempt to automatically determine the project ID
     */
    projectId?: string;
    /**
     * Name of the Pub/Sub topic to publish messages to
     */
    topic: string;
    /**
     * Name of the Pub/Sub subscription that will push messages will be recieved from
     */
    subscription: string;
};

/**
 * Factory function to create a configured message queue
 *
 * @param logger {Logger} Logger instance
 * @param config {CreateMessageQueueConfig} Configuration for the message queue
 * @returns {GCloudPubSubPushMessageQueue}
 */
export async function createMessageQueue(
    logger: Logger,
    {
        pubSubHost,
        hostIsEmulator,
        projectId,
        topic,
        subscription,
    }: CreateMessageQueueConfig,
): Promise<GCloudPubSubPushMessageQueue> {
    // Initialise the Pub/Sub client
    const pubsubClientConfig: Partial<ClientConfig> = {};

    if (pubSubHost !== undefined) {
        pubsubClientConfig.apiEndpoint = pubSubHost;
    }

    if (hostIsEmulator !== undefined) {
        pubsubClientConfig.emulatorMode = hostIsEmulator;
    }

    if (projectId !== undefined) {
        pubsubClientConfig.projectId = projectId;
    }

    const pubSubClient = new PubSub(pubsubClientConfig);

    // Check that the topic exists
    const fullTopic = getFullTopic(pubSubClient.projectId, topic);
    const [topics] = await pubSubClient.getTopics();

    if (!topics.some(({ name }) => name === fullTopic)) {
        throw new Error(`Topic [${topic}] does not exist`);
    }

    // Check that the subscription exists
    const fullSubscription = getFullSubscription(
        pubSubClient.projectId,
        subscription,
    );
    const [subscriptions] = await pubSubClient.getSubscriptions();

    if (!subscriptions.some(({ name }) => name === fullSubscription)) {
        throw new Error(`Subscription [${subscription}] does not exist`);
    }

    // Return a message queue instance
    return new GCloudPubSubPushMessageQueue(logger, pubSubClient, fullTopic);
}
