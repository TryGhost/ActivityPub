import type {
    MessageQueue,
    MessageQueueEnqueueOptions,
    MessageQueueListenOptions,
} from '@fedify/fedify';
import type { PubSub } from '@google-cloud/pubsub';
import type { Logger } from '@logtape/logtape';
import { context, propagation } from '@opentelemetry/api';
import * as Sentry from '@sentry/node';
import type { Context } from 'hono';
import { z } from 'zod';

import type { AccountService } from '@/account/account.service';
import { parseURL } from '@/core/url';
import { analyzeError } from '@/mq/gcloud-pubsub-push/error-utils';

/**
 * Message from Fedify
 */
interface FedifyMessage {
    id: string;
    activity?: {
        [key: string]: unknown;
        type?: string;
        object?: {
            [key: string]: unknown;
            type?: string;
        };
    };
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
 * Message queue implementation using a GCloud Pub/Sub push subscription
 */
export class GCloudPubSubPushMessageQueue implements MessageQueue {
    readonly nativeRetrial = true;
    private messageHandler?: (message: FedifyMessage) => Promise<void> | void;
    private errorListener?: (error: Error) => void;

    constructor(
        private logger: Logger,
        private pubSubClient: PubSub,
        private accountService: AccountService,
        private topic: string,
        private useRetryTopic = false,
        private retryTopic?: string,
        private maxDeliveryAttempts = Number.POSITIVE_INFINITY,
    ) {}

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
     */
    async enqueue(
        message: FedifyMessage,
        options?: MessageQueueEnqueueOptions,
    ): Promise<void> {
        return await Sentry.startSpan(
            {
                op: 'queue.publish',
                name: 'pubsub.message.publish',
                attributes: {
                    'messaging.system': 'pubsub',
                    'messaging.destination': this.topic,
                    'fedify.message_id': message.id,
                },
            },
            async () => {
                const carrier: Record<string, string> = {};
                const activeContext = context.active();
                propagation.inject(activeContext, carrier);

                return this._enqueue(
                    {
                        ...message,
                        traceContext: carrier,
                    },
                    options,
                );
            },
        );
    }

    private async _enqueue(
        message: FedifyMessage,
        options?: MessageQueueEnqueueOptions,
    ): Promise<void> {
        const delay = options?.delay?.total('millisecond');

        // If the message has a delay, do not enqueue it - this is a retry and we want to ignore for now
        if (delay !== undefined) {
            this.logger.info(
                `Not enqueuing message [FedifyID: ${message.id}] due to delay being set: ${delay}`,
                { fedifyId: message.id, mq_message: message },
            );

            return;
        }

        // Filter messages which send to an ActivityPub inbox
        if (message.type === 'outbox' && typeof message.inbox === 'string') {
            const inboxUrl = parseURL(message.inbox);

            if (!inboxUrl) {
                this.logger.error(
                    `Message [FedifyID: ${message.id}] has an inbox URL that is not a valid URL: ${message.inbox}`,
                    { fedifyId: message.id, mq_message: message },
                );

                return;
            }

            const activityTypeIsHandledByDomain =
                message.activity?.type === 'Create' ||
                message.activity?.type === 'Like' ||
                message.activity?.type === 'Announce' ||
                message.activity?.type === 'Delete' ||
                message.activity?.type === 'Undo' ||
                message.activity?.type === 'Update';

            if (
                activityTypeIsHandledByDomain &&
                process.env.FORCE_INTERNAL_ACTIVITY_DELIVERY !== 'true'
            ) {
                // Don't bother doing a DB lookup if the pathname doesn't even match
                if (inboxUrl.pathname.startsWith('/.ghost/activitypub')) {
                    try {
                        const shouldDeliver =
                            await this.accountService.shouldDeliverActivity(
                                inboxUrl,
                            );

                        if (!shouldDeliver) {
                            this.logger.info(
                                `Dropping message [FedifyID: ${message.id}] due to inbox URL being an internal account: ${inboxUrl.href}`,
                                { fedifyId: message.id, mq_message: message },
                            );

                            return;
                        }
                    } catch (error) {
                        this.logger.error(
                            `Failed to get account for message [FedifyID: ${message.id}]: ${error}`,
                            {
                                fedifyId: message.id,
                                error,
                                mq_message: message,
                            },
                        );

                        this.errorListener?.(error as Error);
                    }
                }
            }

            // If the message is an outgoing message, and the account (resolved from the inbox URL) has an active delivery backoff, do not enqueue it
            try {
                const activeBackoff =
                    await this.accountService.getActiveDeliveryBackoff(
                        inboxUrl,
                    );

                if (activeBackoff) {
                    this.logger.warn(
                        `Dropping message [FedifyID: ${message.id}] due to active delivery backoff for inbox: ${inboxUrl.href}. Backoff until: ${activeBackoff.backoffUntil.toISOString()}, Backoff seconds: ${activeBackoff.backoffSeconds}`,
                        {
                            fedifyId: message.id,
                            inboxUrl: inboxUrl.href,
                            backoffUntil:
                                activeBackoff.backoffUntil.toISOString(),
                            backoffSeconds: activeBackoff.backoffSeconds,
                            mq_message: message,
                        },
                    );
                    return;
                }
            } catch (error) {
                this.logger.error(
                    `Failed to check backoff for message [FedifyID: ${message.id}]: ${error}`,
                    { fedifyId: message.id, error, mq_message: message },
                );

                this.errorListener?.(error as Error);

                // Continue with enqueuing if we can't check the backoff
            }
        }

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
     * @param deliveryAttempt The delivery attempt count from GCP (optional)
     */
    async handleMessage(
        message: Message,
        deliveryAttempt?: number,
    ): Promise<void> {
        if (this.messageHandler === undefined) {
            const error = new Error(
                'Message queue is not listening, cannot handle message',
            );

            this.logger.error(
                `Message [FedifyID: ${message.attributes.fedifyId}, PubSubID: ${message.id}] cannot be handled as the message queue is not yet listening`,
                {
                    fedifyId: message.attributes.fedifyId,
                    pubSubId: message.id,
                    mq_message: message.data,
                    error,
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

            await this.handleSuccess(message.data);

            this.logger.info(
                `Acknowledged message [FedifyID: ${fedifyId}, PubSubID: ${message.id}]`,
                { fedifyId, pubSubId: message.id },
            );
        } catch (error) {
            const shouldRetryUsingTopic =
                this.useRetryTopic && this.retryTopic !== undefined;

            const deliveryAttemptCount =
                deliveryAttempt && deliveryAttempt > 0 ? deliveryAttempt : 1;

            const isFromRetryQueue = message.attributes.isRetry === 'true';

            // On main queue: always publish to retry queue on failure
            // On retry queue: throw to use GCP's exponential backoff
            const shouldPublishToRetry = !isFromRetryQueue;

            this.logger.error(
                `Failed to handle message [FedifyID: ${fedifyId}, PubSubID: ${message.id}]: ${error}`,
                {
                    fedifyId,
                    pubSubId: message.id,
                    mq_message: message.data,
                    error,
                    deliveryAttempt: deliveryAttemptCount,
                },
            );

            const errorAnalysis = analyzeError(error as Error);

            if (errorAnalysis.isReportable) {
                this.errorListener?.(error as Error);
            }

            if (
                shouldRetryUsingTopic &&
                errorAnalysis.isRetryable &&
                deliveryAttemptCount < this.maxDeliveryAttempts
            ) {
                if (shouldPublishToRetry) {
                    // From main queue: publish to retry topic
                    this.logger.info(
                        `Publishing to retry topic [FedifyID: ${fedifyId}, PubSubID: ${message.id}]`,
                        {
                            fedifyId,
                            pubSubId: message.id,
                            mq_message: message.data,
                            error,
                            deliveryAttempt: deliveryAttemptCount,
                            isFromRetryQueue,
                        },
                    );

                    await this.pubSubClient
                        .topic(this.retryTopic!)
                        .publishMessage({
                            json: message.data,
                            attributes: {
                                fedifyId,
                                isRetry: 'true',
                            },
                        });
                } else {
                    // From retry queue: throw to let GCP handle exponential backoff
                    this.logger.info(
                        `Throwing error for GCP retry [FedifyID: ${fedifyId}, PubSubID: ${message.id}], attempt ${deliveryAttemptCount}`,
                        {
                            fedifyId,
                            pubSubId: message.id,
                            mq_message: message.data,
                            error,
                            deliveryAttempt: deliveryAttemptCount,
                            isFromRetryQueue,
                        },
                    );

                    throw error;
                }
            } else if (deliveryAttemptCount >= this.maxDeliveryAttempts) {
                if (!errorAnalysis.isReportable) {
                    await this.handlePermanentFailure(
                        message.data,
                        error as Error,
                    );
                }

                this.logger.warn(
                    `Not retrying message [FedifyID: ${fedifyId}, PubSubID: ${message.id}] due to delivery attempt count being >= ${this.maxDeliveryAttempts}`,
                    {
                        fedifyId,
                        pubSubId: message.id,
                        mq_message: message.data,
                        error,
                        deliveryAttempt: deliveryAttemptCount,
                    },
                );
            } else if (shouldRetryUsingTopic && !errorAnalysis.isRetryable) {
                await this.handlePermanentFailure(message.data, error as Error);

                this.logger.warn(
                    `Not retrying permanent failure [FedifyID: ${fedifyId}, PubSubID: ${message.id}]`,
                    {
                        fedifyId,
                        pubSubId: message.id,
                        mq_message: message.data,
                        error,
                        deliveryAttempt: deliveryAttemptCount,
                    },
                );
            } else {
                throw error;
            }
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

    private async handlePermanentFailure(
        message: FedifyMessage,
        error: Error,
    ): Promise<void> {
        if (message.type !== 'outbox') {
            return;
        }

        if (typeof message.inbox !== 'string') {
            return;
        }

        this.logger.info(
            'Recording delivery failure [FedifyID: {fedifyId}]: {error}',
            { fedifyId: message.id, error, mq_message: message },
        );
        try {
            const inboxUrl = new URL(message.inbox);

            await this.accountService.recordDeliveryFailure(
                inboxUrl,
                error.message,
            );
        } catch (error) {
            this.logger.error(
                'Failed to record delivery failure [FedifyID: {fedifyId}]: {error}',
                { fedifyId: message.id, error, mq_message: message },
            );

            this.errorListener?.(error as Error);
        }
    }

    private async handleSuccess(message: FedifyMessage): Promise<void> {
        if (message.type !== 'outbox') {
            return;
        }

        if (typeof message.inbox !== 'string') {
            return;
        }

        try {
            const inboxUrl = new URL(message.inbox);

            await this.accountService.clearDeliveryFailure(inboxUrl);
        } catch (error) {
            this.logger.error(
                `Failed to clear delivery failure [FedifyID: ${message.id}]: ${error}`,
                { fedifyId: message.id, error, mq_message: message },
            );

            this.errorListener?.(error as Error);
        }
    }
}

/**
 * @see https://cloud.google.com/pubsub/docs/push#receive_push
 */
const IncomingPushMessageSchema = z.object({
    deliveryAttempt: z.number().optional(),
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
 * import { createPushMessageHandler, createMessageQueue } from '@/mq/gcloud-pubsub-push';
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

        const message = {
            id: json.message.message_id,
            data,
            attributes: json.message.attributes,
        };

        // TODO: zod schema on FedifyMessage OR have Fedify export a type for us.
        if (
            message.data.traceContext &&
            typeof message.data.traceContext === 'object' &&
            'baggage' in message.data.traceContext &&
            'sentry-trace' in message.data.traceContext &&
            typeof message.data.traceContext.baggage === 'string' &&
            typeof message.data.traceContext['sentry-trace'] === 'string'
        ) {
            logger.debug(
                `Continuing trace from message [FedifyID: ${message.id}] - traceContext: {traceContext}`,
                {
                    fedifyId: message.id,
                    traceContext: message.data.traceContext,
                },
            );

            return Sentry.continueTrace(
                {
                    sentryTrace: message.data.traceContext['sentry-trace'],
                    baggage: message.data.traceContext.baggage,
                },
                () => {
                    return Sentry.startSpan(
                        {
                            op: 'queue.process',
                            name: 'pubsub.message.handle',
                            attributes: {
                                'messaging.system': 'pubsub',
                                'messaging.message_id': message.id,
                                'fedify.message_id': message.id,
                            },
                        },
                        () => {
                            const carrier: Record<string, string> = {};
                            const activeContext = context.active();
                            propagation.inject(activeContext, carrier);

                            message.data.traceContext = carrier;

                            // Handle the message
                            return mq
                                .handleMessage(message, json.deliveryAttempt)
                                .then(() => new Response(null, { status: 200 }))
                                .catch(
                                    () => new Response(null, { status: 500 }),
                                );
                        },
                    );
                },
            );
        }

        // Handle the message
        return mq
            .handleMessage(message, json.deliveryAttempt)
            .then(() => new Response(null, { status: 200 }))
            .catch(() => new Response(null, { status: 500 }));
    };
}
