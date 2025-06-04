import type { PubSub } from '@google-cloud/pubsub';
import { AsyncEvents } from 'core/events';
import type { EventCodec } from 'events/event.codec';

export class PubSubEvents extends AsyncEvents {
    constructor(
        private readonly pubSubClient: PubSub,
        private readonly topicName: string,
        private readonly eventCodec: EventCodec,
    ) {
        super();
    }

    private async publishMessage(
        eventName: string,
        event: object,
    ): Promise<true> {
        const data = await this.eventCodec.encode(eventName, event);
        return new Promise((resolve, reject) => {
            this.pubSubClient.topic(this.topicName).publishMessage(
                {
                    data,
                    attributes: {
                        event: eventName,
                    },
                },
                (err) => {
                    if (err) {
                        reject(err);
                    }
                    resolve(true);
                },
            );
        });
    }

    emit(eventName: string, data: object, ...args: unknown[]) {
        // TODO: Handle promise? Disable this method?
        this.publishMessage(eventName, data);
        return true;
    }

    async emitAsync(eventName: string, data: object, ...args: unknown[]) {
        return await this.publishMessage(eventName, data);
    }

    async handleIncomingMessage(message: {
        attributes: { event: string };
        data: string;
    }) {
        const handlers = this.listeners(message.attributes.event);
        if (handlers.length === 0) {
            return false;
        }
        if (handlers.length !== 1) {
            // Maybe a warning
        }
        const event = await this.eventCodec.decode(
            message.attributes.event,
            Buffer.from(message.data, 'base64'),
        );
        const promises = handlers.map(async (handler) => {
            return handler(
                JSON.parse(
                    Buffer.from(message.data, 'base64').toString('utf-8'),
                ),
            );
        });
        await Promise.all(promises);
    }
}
