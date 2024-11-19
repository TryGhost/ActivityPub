import type { EventEmitter } from 'node:events';
import type {
    MessageQueue,
    MessageQueueEnqueueOptions,
    MessageQueueListenOptions,
} from '@fedify/fedify';
import type { PubSub } from '@google-cloud/pubsub';
import type { Logger } from '@logtape/logtape';
import * as Sentry from '@sentry/node';

import type { MqMessageReceivedEvent } from '../events/mq-message-received-event';

export class GCloudPubSubMessageQueue implements MessageQueue {
    private pubSubClient: PubSub;
    private eventBus: EventEmitter;
    private logger: Logger;
    private topicIdentifier: string;
    private subscriptionIdentifier: string;
    private messageReceivedEventName: string;

    constructor(
        pubSubClient: PubSub,
        eventBus: EventEmitter,
        logger: Logger,
        topicIdentifier: string,
        subscriptionIdentifier: string,
        messageReceivedEventName: string,
    ) {
        this.pubSubClient = pubSubClient;
        this.eventBus = eventBus;
        this.logger = logger;
        this.topicIdentifier = topicIdentifier;
        this.subscriptionIdentifier = subscriptionIdentifier;
        this.messageReceivedEventName = messageReceivedEventName;
    }

    async enqueue(
        message: any,
        options?: MessageQueueEnqueueOptions,
    ): Promise<void> {
        const delay = options?.delay?.total('millisecond');

        if (delay !== undefined) {
            this.logger.info(
                `Not enqueuing message [FedifyID: ${message.id}] due to delay being set: ${delay}`,
            );

            return;
        }

        this.logger.info(`Enqueuing message [FedifyID: ${message.id}]`, {
            mq_message: message.data,
        });

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
        const messageHandler = (message: MqMessageReceivedEvent) => {
            this.handleMessage(message, handler);
        };

        this.eventBus.on(this.messageReceivedEventName, messageHandler);

        return await new Promise((resolve) => {
            options.signal?.addEventListener('abort', () => {
                this.eventBus.removeListener(
                    this.messageReceivedEventName,
                    messageHandler,
                );

                resolve();
            });
        });
    }

    private async handleMessage(
        message: MqMessageReceivedEvent,
        handler: (message: any) => Promise<void> | void,
    ) {
        const fedifyId = message.attributes.fedifyId ?? 'unknown';

        if (message.subscriptionIdentifier !== this.subscriptionIdentifier) {
            this.logger.info(
                `Not handling message [FedifyID: ${fedifyId}, PubSubID: ${message.id}] due to subscription mismatch [${message.subscriptionIdentifier} !== ${this.subscriptionIdentifier}]`,
            );

            message.nack();

            return;
        }

        this.logger.info(
            `Handling message [FedifyID: ${fedifyId}, PubSubID: ${message.id}]`,
            {
                mq_message: message.data,
            },
        );

        try {
            await handler(message.data);

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
    }
}
