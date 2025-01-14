import type {
    MessageQueue,
    MessageQueueEnqueueOptions,
    MessageQueueListenOptions,
} from '@fedify/fedify';
import { type ClientConfig, PubSub } from '@google-cloud/pubsub';
import type { Logger } from '@logtape/logtape';
import type { Context } from 'hono';
import { z } from 'zod';

/**
 * Message from Fedify
 */
interface FedifyMessage {
    id: string;
    [key: string]: unknown;
}

/**
 * Message from a Pub/Sub push subscription
 */
interface Message {
    /**
     * Unique identifier for the message
     */
    id: string;
    /**
     * Data contained within the message
     */
    data: FedifyMessage;
    /**
     * Additional metadata about the message
     */
    attributes: Record<string, string>;
}

/**
 * Get the full name of a Pub/Sub topic
 *
 * @param projectId ID of the Pub/Sub project
 * @param topic Name of the topic
 */
function getFullTopic(projectId: string, topic: string) {
    return `projects/${projectId}/topics/${topic}`;
}

/**
 * Get the full name of a Pub/Sub subscription
 *
 * @param projectId ID of the Pub/Sub project
 * @param subscription Name of the subscription
 */
function getFullSubscription(projectId: string, subscription: string) {
    return `projects/${projectId}/subscriptions/${subscription}`;
}

/**
 * Message queue implementation using a GCloud Pub/Sub push subscription
 */
export class GCloudPubSubPushMessageQueue implements MessageQueue {
    private logger: Logger;
    private pubSubClient: PubSub;
    private topic: string;
    private messageHandler?: (message: FedifyMessage) => Promise<void> | void;
    private errorListener?: (error: Error) => void;

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
     * Enqueue a message
     *
     * @param message Message to enqueue
     * @param options Options for the enqueue operation
     */
    async enqueue(
        message: FedifyMessage,
        options?: MessageQueueEnqueueOptions,
    ): Promise<void> {
        const delay = options?.delay?.total('millisecond');

        // If the message has a delay, do not enqueue it - This is likely a retry
        // attempt by Fedify, but we do not want to retry the message as we want
        // to use GCloud Pub/Sub's built in retry mechanism
        if (delay !== undefined) {
            this.logger.info(
                `Not enqueuing message [FedifyID: ${message.id}] due to delay being set: ${delay}`,
                { fedifyId: message.id, mq_message: message },
            );

            return;
        }

        this.logger.info(`Enqueuing message [FedifyID: ${message.id}]`, {
            fedifyId: message.id,
            mq_message: message,
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
                {
                    fedifyId: message.id,
                    pubSubId: messageId,
                    mq_message: message,
                },
            );
        } catch (error) {
            this.logger.error(
                `Failed to enqueue message [FedifyID: ${message.id}]: ${error}`,
                { fedifyId: message.id, error, mq_message: message },
            );

            this.errorListener?.(error as Error);
        }
    }

    /**
     * Start the message queue
     *
     * @param handler Message handler
     * @param options Options for the listen operation
     */
    async listen(
        handler: (message: FedifyMessage) => Promise<void> | void,
        options: MessageQueueListenOptions = {},
    ): Promise<void> {
        this.messageHandler = handler;

        return await new Promise((resolve) => {
            options.signal?.addEventListener('abort', () => {
                this.messageHandler = undefined;

                resolve();
            });
        });
    }

    /**
     * Handle a message
     *
     * @param message Message to handle
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
                    mq_message: message.data,
                },
            );

            throw error;
        }

        const fedifyId = message.attributes.fedifyId ?? 'unknown';

        this.logger.info(
            `Handling message [FedifyID: ${fedifyId}, PubSubID: ${message.id}]`,
            { fedifyId, pubSubId: message.id, mq_message: message.data },
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
                {
                    fedifyId,
                    pubSubId: message.id,
                    error,
                    mq_message: message.data,
                },
            );

            this.errorListener?.(error as Error);

            throw error;
        }
    }

    /**
     * Register an error listener
     *
     * @param listener Error listener
     */
    registerErrorListener(listener: (error: Error) => void): void {
        this.errorListener = listener;
    }
}

/**
 * @see https://cloud.google.com/pubsub/docs/push#receive_push
 */
const IncomingPushMessageSchema = z.object({
    message: z.object({
        message_id: z.string(),
        data: z.string(),
        attributes: z.record(z.string()),
    }),
});

/**
 * Create a handler to handle an incoming message from a Pub/Sub push subscription
 *
 * @param mq Message queue instance
 * @param logger Logger instance
 *
 * @example
 * ```
 * import { createPushMessageHandler, createMessageQueue } from './mq/gcloud-pubsub-push';
 *
 * const queue = await createMessageQueue(...);
 *
 * app.post('/mq', createPushMessageHandler(queue, logging));
 * ```
 */
export function createPushMessageHandler(
    mq: GCloudPubSubPushMessageQueue,
    logger: Logger,
) {
    /**
     * Handle an incoming message from a Pub/Sub push subscription
     *
     * @param ctx Hono context instance
     */
    return async function handlePushMessage(ctx: Context) {
        // Check that the message queue is listening and if not, return a non-200
        // response to instruct GCloud Pub/Sub to back off from pushing messages to
        // this endpoint - See https://cloud.google.com/pubsub/docs/push#push_backoff
        if (mq.isListening === false) {
            logger.info(
                'Message queue is not listening, cannot handle message',
            );

            return new Response(null, { status: 429 });
        }

        // Validate the incoming data
        let json: z.infer<typeof IncomingPushMessageSchema>;
        let data: FedifyMessage;

        try {
            json = IncomingPushMessageSchema.parse(
                (await ctx.req.json()) as unknown,
            );

            // We expect the message data to be base64 encoded JSON - See
            //  - https://cloud.google.com/pubsub/docs/publish-message-overview#about-messages
            //  - https://cloud.google.com/pubsub/docs/reference/rest/v1/PubsubMessage
            // (we use https://github.com/googleapis/nodejs-pubsub to publish
            // messages which uses the REST API)
            data = JSON.parse(
                Buffer.from(json.message.data, 'base64').toString(),
            );
        } catch (error) {
            logger.error(`Invalid incoming push message received: ${error}`, {
                error,
            });

            return new Response(null, { status: 400 });
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
 * Create a configured message queue
 *
 * @param logger Logger instance
 * @param config Configuration for the message queue
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
) {
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
