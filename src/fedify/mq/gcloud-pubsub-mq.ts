import type {
    MessageQueue,
    MessageQueueEnqueueOptions,
    MessageQueueListenOptions,
} from '@fedify/fedify';
import type { Message, PubSub } from '@google-cloud/pubsub';
import type { Logger } from '@logtape/logtape';
import * as Sentry from '@sentry/node';

export class GCloudPubSubMessageQueue implements MessageQueue {
    private pubSubClient: PubSub;
    private topicIdentifier: string;
    private subscriptionIdentifier: string;
    private logger: Logger;

    constructor(
        pubSubClient: PubSub,
        topicIdentifier: string,
        subscriptionIdentifier: string,
        logger: Logger,
    ) {
        this.pubSubClient = pubSubClient;
        this.topicIdentifier = topicIdentifier;
        this.subscriptionIdentifier = subscriptionIdentifier;
        this.logger = logger;
    }

    async enqueue(
        message: any,
        options?: MessageQueueEnqueueOptions,
    ): Promise<void> {
        const delay = options?.delay?.total('millisecond') ?? 0;

        this.logger.info(
            `Enqueuing message [FedifyID: ${message.id}] with delay: ${delay}ms`,
        );

        if (delay > 0) {
            await new Promise((resolve) => setTimeout(resolve, delay));
        }

        try {
            const messageId = await this.pubSubClient
                .topic(this.topicIdentifier)
                .publishMessage({
                    json: message,
                    attributes: {
                        fedifyId: message.id,
                    },
                });

            this.logger.info(
                `Message [FedifyID: ${message.id}] was enqueued [PubSubID: ${messageId}]`,
            );
        } catch (error) {
            this.logger.error(
                `Failed to enqueue message [FedifyID: ${message.id}]: ${error}`,
            );

            Sentry.captureException(error);

            throw error;
        }
    }

    async listen(
        handler: (message: any) => Promise<void> | void,
        options: MessageQueueListenOptions = {},
    ): Promise<void> {
        const subscription = this.pubSubClient.subscription(
            this.subscriptionIdentifier,
        );

        subscription
            .on('message', async (message: Message) => {
                const fedifyId = message.attributes.fedifyId ?? 'unknown';

                this.logger.info(
                    `Handling message [FedifyID: ${fedifyId}, PubSubID: ${message.id}]`,
                );

                try {
                    const json = JSON.parse(message.data.toString());

                    await handler(json);

                    message.ack();

                    this.logger.info(
                        `Acknowledged message [FedifyID: ${fedifyId}, PubSubID: ${message.id}]`,
                    );
                } catch (error) {
                    message.nack();

                    this.logger.error(
                        `Failed to handle message [FedifyID: ${fedifyId}, PubSubID: ${message.id}]: ${error}`,
                    );

                    Sentry.captureException(error);
                }
            })
            .on('error', (error) => {
                this.logger.error(
                    `Subscription [${this.subscriptionIdentifier}] error occurred: ${error}`,
                );

                Sentry.captureException(error);

                // This is a fatal error, so we should throw to stop the listener / process
                throw error;
            })
            .on('close', () => {
                this.logger.info(
                    `Subscription [${this.subscriptionIdentifier}] closed`,
                );
            });

        return await new Promise((resolve) => {
            options.signal?.addEventListener('abort', () => {
                subscription
                    .removeAllListeners()
                    .close()
                    .then(() => resolve());
            });
        });
    }
}
