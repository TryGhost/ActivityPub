import EventEmitter from 'node:events';
import type {
    MessageQueue,
    MessageQueueEnqueueOptions,
    MessageQueueListenOptions,
} from '@fedify/fedify';
import { type ClientConfig, PubSub } from '@google-cloud/pubsub';
import type { Logger } from '@logtape/logtape';
import type { Context } from 'hono';

export enum MessageEvent {
    ACK = 'ack',
    NACK = 'nack',
}

export type MessageEventListener = (...args: unknown[]) => void;

export type MessageOptions = {
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
};

/**
 * Represents a message from a Pub/Sub push subscription
 */
export class Message {
    readonly id: string;
    readonly data: Record<string, unknown>;
    readonly attributes: Record<string, string>;
    private events: EventEmitter;

    /**
     * Creates a new message
     *
     * @param options {MessageOptions} Options for the message
     */
    constructor({ id, data, attributes }: MessageOptions) {
        this.id = id;
        this.data = data;
        this.attributes = attributes;
        this.events = new EventEmitter();
    }

    /**
     * Sets up a listener for an event that can occur on the message
     *
     * @param event {MessageEvent} Event to listen for
     * @param listener {MessageEventListener} Listener for the event
     */
    on(event: MessageEvent, listener: MessageEventListener) {
        this.events.on(event, listener);
    }

    /**
     * Acknowledges a message
     */
    ack() {
        this.events.emit(MessageEvent.ACK);
    }

    /**
     * Negatively acknowledges a message
     */
    nack() {
        this.events.emit(MessageEvent.NACK);
    }
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

    private messageEvent = 'message';
    private errorEvent = '_error';
    private events: EventEmitter;

    /**
     * Creates a new message queue
     *
     * @param logger {Logger} Logger instance
     * @param pubSubClient {PubSub} Pub/Sub client instance
     * @param topic {string} Name of topic to publish messages to
     */
    constructor(logger: Logger, pubSubClient: PubSub, topic: string) {
        this.logger = logger;
        this.pubSubClient = pubSubClient;
        this.topic = topic;
        this.events = new EventEmitter();
    }

    /**
     * Indicates whether the message queue is listening for messages or not
     */
    get isListening(): boolean {
        return this.events.listenerCount(this.messageEvent) > 0;
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
                .topic(getFullTopic(this.pubSubClient.projectId, this.topic))
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

            this.events.emit(this.errorEvent, error);
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
        // Set up a listener to handle messages
        this.events.on(this.messageEvent, async (message: Message) => {
            const fedifyId = message.attributes.fedifyId ?? 'unknown';

            this.logger.info(
                `Handling message [FedifyID: ${fedifyId}, PubSubID: ${message.id}]`,
                { fedifyId, pubSubId: message.id },
            );

            try {
                await handler(message.data);

                message.ack();

                this.logger.info(
                    `Acknowledged message [FedifyID: ${fedifyId}, PubSubID: ${message.id}]`,
                    { fedifyId, pubSubId: message.id },
                );
            } catch (error) {
                message.nack();

                this.logger.error(
                    `Failed to handle message [FedifyID: ${fedifyId}, PubSubID: ${message.id}]: ${error}`,
                    { fedifyId, pubSubId: message.id, error },
                );

                this.events.emit(this.errorEvent, error);
            }
        });

        // Return a promise that resolves when the message queue is stopped
        return await new Promise((resolve) => {
            options.signal?.addEventListener('abort', () => {
                this.events.removeAllListeners();
                resolve();
            });
        });
    }

    /**
     * Handles a message
     *
     * Ensure that the message queue is listening before calling this method
     *
     * @param message {Message} Message to handle
     */
    handleMessage(message: Message): void {
        if (this.isListening === false) {
            this.logger.warn(
                `Message [FedifyID: ${message.attributes.fedifyId}, PubSubID: ${message.id}] cannot be handled as the message queue is not yet listening`,
                { fedifyId: message.attributes.fedifyId, pubSubId: message.id },
            );
        }

        this.events.emit(this.messageEvent, message);
    }

    /**
     * Registers an error listener
     *
     * If an error occurs, the provided listener will be executed with the error
     *
     * @param listener {function}
     */
    registerErrorListener(listener: (error: Error) => void): void {
        this.events.on(this.errorEvent, listener);
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

        return new Promise<Response>((resolve) => {
            // Check that the message queue is listening
            if (mq.isListening === false) {
                return resolve(new Response(null, { status: 429 }));
            }

            let data = {};

            // Attempt to parse the incoming message data
            try {
                data = JSON.parse(
                    Buffer.from(json.message.data, 'base64').toString(),
                );
            } catch (error) {
                return resolve(new Response(null, { status: 500 }));
            }

            // Create a message instance from the incoming message data
            const message = new Message({
                id: json.message.message_id,
                data,
                attributes: json.message.attributes,
            });

            message.on(MessageEvent.ACK, () => {
                resolve(new Response(null, { status: 200 }));
            });

            message.on(MessageEvent.NACK, () => {
                resolve(new Response(null, { status: 500 }));
            });

            // Handle the message
            mq.handleMessage(message);
        });
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
    const [topics] = await pubSubClient.getTopics();

    if (
        !topics.some(
            ({ name }) => name === getFullTopic(pubSubClient.projectId, topic),
        )
    ) {
        throw new Error(`Topic [${topic}] does not exist`);
    }

    // Check that the subscription exists
    const [subscriptions] = await pubSubClient.getSubscriptions();

    if (
        !subscriptions.some(
            ({ name }) =>
                name ===
                getFullSubscription(pubSubClient.projectId, subscription),
        )
    ) {
        throw new Error(`Subscription [${subscription}] does not exist`);
    }

    // Return a message queue instance
    return new GCloudPubSubPushMessageQueue(logger, pubSubClient, topic);
}
