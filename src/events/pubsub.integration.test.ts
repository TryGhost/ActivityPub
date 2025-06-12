import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import { type Message, PubSub, type Subscription } from '@google-cloud/pubsub';
import type { Logger } from '@logtape/logtape';

import { EventSerializer } from './event';
import {
    PUBSUB_MESSAGE_ATTR_EVENT_HOST,
    PUBSUB_MESSAGE_ATTR_EVENT_NAME,
    PubSubEvents,
} from './pubsub';

function encode(data: object) {
    return Buffer.from(JSON.stringify(data)).toString('base64');
}

function decode(message: Message) {
    return JSON.parse(message.data.toString());
}

class TestEvent {
    constructor(private readonly id: number) {}

    toJSON() {
        return {
            id: this.id,
        };
    }

    static fromJSON(data: object) {
        if (!('id' in data) || !(typeof data.id === 'number')) {
            throw new Error('id must be a number');
        }

        return new TestEvent(data.id);
    }
}

describe.skip('PubSubEvents', () => {
    let pubSubClient: PubSub;
    let subscription: Subscription;
    let eventSerializer: EventSerializer;
    let pubSubEvents: PubSubEvents;
    let logger: Logger;

    beforeAll(async () => {
        if (!process.env.MQ_PUBSUB_HOST) {
            throw new Error('MQ_PUBSUB_HOST is not set');
        }

        if (!process.env.MQ_PUBSUB_PROJECT_ID) {
            throw new Error('MQ_PUBSUB_PROJECT_ID is not set');
        }

        if (!process.env.MQ_PUBSUB_GHOST_TOPIC_NAME) {
            throw new Error('MQ_PUBSUB_GHOST_TOPIC_NAME is not set');
        }

        pubSubClient = new PubSub({
            projectId: process.env.MQ_PUBSUB_PROJECT_ID,
            emulatorMode: true,
            apiEndpoint: process.env.MQ_PUBSUB_HOST,
        });

        [subscription] = await pubSubClient.createSubscription(
            process.env.MQ_PUBSUB_GHOST_TOPIC_NAME,
            'pubsub-events-test',
        );
    });

    afterAll(async () => {
        await subscription.delete();
    });

    beforeEach(() => {
        eventSerializer = new EventSerializer();

        logger = {
            error: vi.fn(),
        } as unknown as Logger;

        pubSubEvents = new PubSubEvents(
            pubSubClient,
            process.env.MQ_PUBSUB_GHOST_TOPIC_NAME!,
            eventSerializer,
            logger,
        );
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should publish an event to Pub/Sub', async () => {
        const eventName = 'foo';
        const event = new TestEvent(123);
        const host = 'example.com';

        const messagePromise = new Promise<Message>((resolve) => {
            subscription.on('message', (message) => {
                message.ack();

                resolve(message);
            });
        });

        const result = await pubSubEvents.emitAsync(eventName, event, host);

        expect(result).toBe(true);

        const receivedMessage = await messagePromise;

        expect(decode(receivedMessage)).toEqual(event.toJSON());

        expect(receivedMessage.attributes).toEqual({
            [PUBSUB_MESSAGE_ATTR_EVENT_NAME]: eventName,
            [PUBSUB_MESSAGE_ATTR_EVENT_HOST]: host,
        });
    });

    it('should fail gracefully if the event cannot be published', async () => {
        const eventName = 'foo';
        const event = new TestEvent(123);
        const host = 'example.com';

        vi.spyOn(pubSubClient, 'topic').mockRejectedValue(
            new Error('test error'),
        );

        const result = await pubSubEvents.emitAsync(eventName, event, host);

        expect(result).toBe(false);

        expect(logger.error).toHaveBeenCalledTimes(1);
    });

    it('should handle an incoming message', async () => {
        const eventName = 'foo';

        eventSerializer.register(eventName, TestEvent);

        const host = 'example.com';
        const event = new TestEvent(123);

        const messageData = encode(event.toJSON());
        const messageAttributes = {
            [PUBSUB_MESSAGE_ATTR_EVENT_NAME]: eventName,
            [PUBSUB_MESSAGE_ATTR_EVENT_HOST]: host,
        };

        const handler1 = vi.fn().mockResolvedValue(true);
        const handler2 = vi.fn().mockResolvedValue(true);

        pubSubEvents.on(eventName, handler1);
        pubSubEvents.on(eventName, handler2);

        await pubSubEvents.handleIncomingMessage(
            messageData,
            messageAttributes,
        );

        expect(handler1).toHaveBeenCalledWith(event);
        expect(handler2).toHaveBeenCalledWith(event);
    });

    it('should gracefully handle an incoming message', async () => {
        const eventName = 'foo';

        eventSerializer.register(eventName, TestEvent);

        const host = 'example.com';
        const event = new TestEvent(123);

        const messageData = encode(event.toJSON());
        const messageAttributes = {
            [PUBSUB_MESSAGE_ATTR_EVENT_NAME]: eventName,
            [PUBSUB_MESSAGE_ATTR_EVENT_HOST]: host,
        };

        const handler1 = vi
            .fn()
            .mockRejectedValue(new Error('Handler 1 error'));
        const handler2 = vi.fn().mockResolvedValue(true);
        const handler3 = vi
            .fn()
            .mockRejectedValue(new Error('Handler 3 error'));

        pubSubEvents.on(eventName, handler1);
        pubSubEvents.on(eventName, handler2);
        pubSubEvents.on(eventName, handler3);

        await pubSubEvents.handleIncomingMessage(
            messageData,
            messageAttributes,
        );

        expect(handler1).toHaveBeenCalledWith(event);
        expect(handler2).toHaveBeenCalledWith(event);
        expect(handler3).toHaveBeenCalledWith(event);

        expect(logger.error).toHaveBeenCalledTimes(2);
    });

    it('should throw an error if the message data cannot be decoded', async () => {
        const eventName = 'foo';

        eventSerializer.register(eventName, TestEvent);

        const messageData = 'invalid';
        const messageAttributes = {
            [PUBSUB_MESSAGE_ATTR_EVENT_NAME]: eventName,
            [PUBSUB_MESSAGE_ATTR_EVENT_HOST]: 'example.com',
        };

        await expect(
            pubSubEvents.handleIncomingMessage(messageData, messageAttributes),
        ).rejects.toThrow('Incoming message data could not be decoded');
    });

    it('should throw an error if the required attributes are missing', async () => {
        const eventName = 'foo';

        eventSerializer.register(eventName, TestEvent);

        const messageData = encode({
            id: 123,
        });

        await expect(
            pubSubEvents.handleIncomingMessage(messageData, {}),
        ).rejects.toThrow(
            `Incoming message is missing attribute [${PUBSUB_MESSAGE_ATTR_EVENT_HOST}]`,
        );

        await expect(
            pubSubEvents.handleIncomingMessage(messageData, {
                [PUBSUB_MESSAGE_ATTR_EVENT_HOST]: 'example.com',
            }),
        ).rejects.toThrow(
            `Incoming message is missing attribute [${PUBSUB_MESSAGE_ATTR_EVENT_NAME}]`,
        );
    });
});
