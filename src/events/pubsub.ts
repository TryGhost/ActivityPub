import type { PubSub } from '@google-cloud/pubsub';
import type { Logger } from '@logtape/logtape';
import { AsyncEvents } from 'core/events';
import type { EventSerializer, SerializableEvent } from './event';

export const PUBSUB_MESSAGE_ATTR_EVENT_HOST = 'event_host';
export const PUBSUB_MESSAGE_ATTR_EVENT_NAME = 'event_name';

export class PubSubEvents extends AsyncEvents {
    constructor(
        private readonly pubSubClient: PubSub,
        private readonly topic: string,
        private readonly serializer: EventSerializer,
        private readonly logger: Logger,
    ) {
        super();
    }

    async emitAsync(name: string, event: SerializableEvent, host: string) {
        try {
            await this.pubSubClient.topic(this.topic).publishMessage({
                json: this.serializer.serialize(event),
                attributes: {
                    [PUBSUB_MESSAGE_ATTR_EVENT_NAME]: name,
                    [PUBSUB_MESSAGE_ATTR_EVENT_HOST]: host,
                },
            });

            return true;
        } catch (error) {
            this.logger.error(
                'Failed to publish event [{event}] to Pub/Sub: {error}',
                {
                    event: name,
                    error:
                        error instanceof Error ? error.message : String(error),
                },
            );

            return false;
        }
    }

    async handleIncomingMessage(
        data: string,
        attributes: Record<string, string>,
    ) {
        const eventHost = attributes[PUBSUB_MESSAGE_ATTR_EVENT_HOST];

        if (!eventHost) {
            throw new Error(
                `Incoming message is missing attribute [${PUBSUB_MESSAGE_ATTR_EVENT_HOST}]`,
            );
        }

        const eventName = attributes[PUBSUB_MESSAGE_ATTR_EVENT_NAME];

        if (!eventName) {
            throw new Error(
                `Incoming message is missing attribute [${PUBSUB_MESSAGE_ATTR_EVENT_NAME}]`,
            );
        }

        let decodedData: Record<string, unknown>;

        try {
            decodedData = JSON.parse(Buffer.from(data, 'base64').toString());

            if (
                typeof decodedData !== 'object' ||
                decodedData === null ||
                Array.isArray(decodedData)
            ) {
                throw new Error('Not a valid object');
            }
        } catch (error) {
            throw new Error(
                `Incoming message data could not be decoded: ${error instanceof Error ? error.message : String(error)}`,
            );
        }

        const event = this.serializer.deserialize(eventName, decodedData);

        const results = await Promise.allSettled(
            this.listeners(eventName).map((handler) => handler(event)),
        );

        for (const result of results) {
            if (result.status === 'rejected') {
                this.logger.error(
                    'Event handler for [{event}] on host [{host}] failed: {error}',
                    {
                        event: eventName,
                        host: eventHost,
                        error: result.reason,
                    },
                );
            }
        }
    }
}
