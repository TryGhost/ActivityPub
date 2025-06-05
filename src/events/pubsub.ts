import type { PubSub } from '@google-cloud/pubsub';

import { AsyncEvents } from 'core/events';
import type { EventSerializer, SerializableEvent } from './event';

export const PUBSUB_MESSAGE_ATTR_EVENT_NAME = 'event_name';

export class PubSubEvents extends AsyncEvents {
    constructor(
        private readonly pubSubClient: PubSub,
        private readonly topic: string,
        private readonly serializer: EventSerializer,
    ) {
        super();
    }

    async emitAsync(name: string, event: SerializableEvent) {
        await this.pubSubClient.topic(this.topic).publishMessage({
            json: this.serializer.serialize(event),
            attributes: {
                [PUBSUB_MESSAGE_ATTR_EVENT_NAME]: name,
            },
        });

        return true;
    }

    async handleIncomingMessage(
        data: string,
        attributes: Record<string, string>,
    ) {
        const eventName = attributes[PUBSUB_MESSAGE_ATTR_EVENT_NAME];

        if (!eventName) {
            throw new Error(
                `Incoming message is missing attribute: "${PUBSUB_MESSAGE_ATTR_EVENT_NAME}"`,
            );
        }

        let decodedData: object;

        try {
            decodedData = JSON.parse(Buffer.from(data, 'base64').toString());
        } catch (error) {
            throw new Error(
                `Incoming message data could not be decoded: ${error instanceof Error ? error.message : String(error)}`,
            );
        }

        const event = this.serializer.deserialize(eventName, decodedData);

        await Promise.all(
            this.listeners(eventName).map((handler) => handler(event)),
        );
    }
}
