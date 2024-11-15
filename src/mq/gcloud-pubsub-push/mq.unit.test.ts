import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';

import { setTimeout } from 'node:timers/promises';
import { PubSub, type Topic } from '@google-cloud/pubsub';
import { Temporal } from '@js-temporal/polyfill';
import type { Logger } from '@logtape/logtape';
import type { Context } from 'hono';

import {
    GCloudPubSubPushMessageQueue,
    Message,
    MessageEvent,
    createMessageQueue,
    handlePushMessage,
} from './mq';

vi.mock('@google-cloud/pubsub', () => ({
    PubSub: vi.fn(),
}));

describe('Message', () => {
    it('can be acknowledged', () => {
        const message = new Message({
            id: 'abc123',
            data: {},
            attributes: {},
        });

        const ack = vi.fn();

        message.on(MessageEvent.ACK, ack);

        message.ack();

        expect(ack).toHaveBeenCalled();
    });

    it('can be negatively acknowledged', () => {
        const message = new Message({
            id: 'abc123',
            data: {},
            attributes: {},
        });

        const nack = vi.fn();

        message.on(MessageEvent.NACK, nack);

        message.nack();

        expect(nack).toHaveBeenCalled();
    });
});

describe('GCloudPubSubPushMessageQueue', () => {
    const PROJECT_ID = 'test_project';
    const TOPIC = 'test_topic';

    let mockLogger: Logger;
    let mockTopic: Topic;
    let mockPubSubClient: PubSub;

    beforeEach(() => {
        mockLogger = {
            info: vi.fn(),
            error: vi.fn(),
            warn: vi.fn(),
        } as unknown as Logger;

        mockTopic = {
            publishMessage: vi.fn(),
        } as unknown as Topic;

        mockPubSubClient = {
            projectId: PROJECT_ID,
            topic: vi.fn((topic) => {
                const fullTopic = `projects/${PROJECT_ID}/topics/${TOPIC}`;

                if (topic === fullTopic) {
                    return mockTopic;
                }

                throw new Error(`Unexpected topic: ${topic}`);
            }),
        } as unknown as PubSub;
    });

    describe('enqueue', () => {
        it('should publish a message', async () => {
            const mq = new GCloudPubSubPushMessageQueue(
                mockLogger,
                mockPubSubClient,
                TOPIC,
            );

            const message = {
                id: 'abc123',
            };

            await mq.enqueue(message);

            expect(mockTopic.publishMessage).toHaveBeenCalledTimes(1);
            expect(mockTopic.publishMessage).toHaveBeenCalledWith({
                json: message,
                attributes: {
                    fedifyId: message.id,
                },
            });
        });

        it('should handle an error if message publishing fails', async () => {
            const error = new Error('Failed to publish message');

            (mockTopic.publishMessage as Mock).mockRejectedValue(error);

            const mq = new GCloudPubSubPushMessageQueue(
                mockLogger,
                mockPubSubClient,
                TOPIC,
            );

            const errorListener = vi.fn();
            mq.registerErrorListener(errorListener);

            const message = {
                id: 'abc123',
            };

            await mq.enqueue(message);

            expect(errorListener).toHaveBeenCalledTimes(1);
            expect(errorListener).toHaveBeenCalledWith(error);
        });

        it('should not publish a message if a delay is set', async () => {
            const mq = new GCloudPubSubPushMessageQueue(
                mockLogger,
                mockPubSubClient,
                TOPIC,
            );

            const message = {
                id: 'abc123',
            };

            await mq.enqueue(message, {
                delay: Temporal.Duration.from({ seconds: 1 }),
            });

            expect(mockTopic.publishMessage).not.toHaveBeenCalled();
        });
    });

    describe('listen', () => {
        it('should return a promise that resolves when the signal is aborted', async () => {
            const mq = new GCloudPubSubPushMessageQueue(
                mockLogger,
                mockPubSubClient,
                TOPIC,
            );

            const abortController = new AbortController();

            const listenPromise = mq.listen(vi.fn(), {
                signal: abortController.signal,
            });

            abortController.abort();

            await expect(listenPromise).resolves.toBeUndefined();
        });

        it('should setup a listener that acknowledges messages if they are successfully handled', async () => {
            const mq = new GCloudPubSubPushMessageQueue(
                mockLogger,
                mockPubSubClient,
                TOPIC,
            );

            // Listen
            const handler = vi.fn().mockResolvedValue(undefined);
            mq.listen(handler);

            // Init message to be handled
            const message = new Message({
                id: 'abc123',
                data: {},
                attributes: {},
            });
            const ack = vi.fn();

            message.on(MessageEvent.ACK, ack);

            // Handle the message
            mq.handleMessage(message);

            // Give the ack listener time to be called
            await setTimeout(1);

            // Assert
            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler).toHaveBeenCalledWith(message.data);
            expect(ack).toHaveBeenCalledTimes(1);
        });

        it('should setup a listener that negatively acknowledges messages if they are not successfully handled', async () => {
            const mq = new GCloudPubSubPushMessageQueue(
                mockLogger,
                mockPubSubClient,
                TOPIC,
            );

            // Listen
            const handler = vi
                .fn()
                .mockRejectedValue(new Error('Failed to handle message'));
            mq.listen(handler);

            // Init message to be handled
            const message = new Message({
                id: 'abc123',
                data: {},
                attributes: {},
            });
            const nack = vi.fn();

            message.on(MessageEvent.NACK, nack);

            // Handle the message
            mq.handleMessage(message);

            // Give the nack listener time to be called
            await setTimeout(1);

            // Assert
            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler).toHaveBeenCalledWith(message.data);
            expect(nack).toHaveBeenCalledTimes(1);
        });

        it('should setup a listener that handles errors', async () => {
            const mq = new GCloudPubSubPushMessageQueue(
                mockLogger,
                mockPubSubClient,
                TOPIC,
            );

            const errorListener = vi.fn();
            mq.registerErrorListener(errorListener);

            // Listen
            const error = new Error('Failed to handle message');
            const handler = vi.fn().mockRejectedValue(error);

            mq.listen(handler);

            // Handle the message
            mq.handleMessage(
                new Message({
                    id: 'abc123',
                    data: {},
                    attributes: {},
                }),
            );

            // Give the error listener time to be called
            await setTimeout(1);

            // Assert
            expect(errorListener).toHaveBeenCalledTimes(1);
            expect(errorListener).toHaveBeenCalledWith(error);
        });
    });
});

describe('handlePushMessage', () => {
    const PROJECT_ID = 'test_project';
    const TOPIC = 'test_topic';

    let ctx: Context;
    let mockLogger: Logger;
    let mockPubSubClient: PubSub;

    beforeEach(() => {
        ctx = {
            req: {
                json: vi.fn(),
            },
        } as unknown as Context;

        mockLogger = {
            info: vi.fn(),
            error: vi.fn(),
            warn: vi.fn(),
        } as unknown as Logger;

        mockPubSubClient = {
            projectId: PROJECT_ID,
        } as unknown as PubSub;
    });

    it('should return a 429 response if the message queue is not listening', async () => {
        const mq = new GCloudPubSubPushMessageQueue(
            mockLogger,
            mockPubSubClient,
            TOPIC,
        );

        const result = await handlePushMessage(mq)(ctx);

        expect(result.status).toBe(429);
    });

    it('should return a 500 response if the incoming message data cannot be parsed', async () => {
        const mq = new GCloudPubSubPushMessageQueue(
            mockLogger,
            mockPubSubClient,
            TOPIC,
        );

        mq.listen(vi.fn());

        const result = await handlePushMessage(mq)(ctx);

        expect(result.status).toBe(500);
    });

    it('should return a 200 response if the incoming message is successfully handled', async () => {
        const mq = new GCloudPubSubPushMessageQueue(
            mockLogger,
            mockPubSubClient,
            TOPIC,
        );

        (ctx.req.json as Mock).mockResolvedValue({
            message: {
                data: Buffer.from(JSON.stringify({ id: 'abc123' })).toString(
                    'base64',
                ),
                attributes: {},
            },
        });

        mq.listen(vi.fn().mockResolvedValue(undefined));

        const result = await handlePushMessage(mq)(ctx);

        expect(result.status).toBe(200);
    });

    it('should return a 500 response if the incoming message is not successfully handled', async () => {
        const mq = new GCloudPubSubPushMessageQueue(
            mockLogger,
            mockPubSubClient,
            TOPIC,
        );

        (ctx.req.json as Mock).mockResolvedValue({
            message: {
                data: Buffer.from(JSON.stringify({ id: 'abc123' })).toString(
                    'base64',
                ),
                attributes: {},
            },
        });

        mq.listen(
            vi.fn().mockRejectedValue(new Error('Failed to handle message')),
        );

        const result = await handlePushMessage(mq)(ctx);

        expect(result.status).toBe(500);
    });
});

describe('createMessageQueue', () => {
    const PROJECT_ID = 'test_project';
    const TOPIC = 'test_topic';
    const SUBSCRIPTION = 'test_subscription';

    let mockLogger: Logger;

    beforeEach(() => {
        mockLogger = {
            info: vi.fn(),
            error: vi.fn(),
        } as unknown as Logger;

        (PubSub as unknown as Mock).mockImplementation(() => ({
            projectId: PROJECT_ID,
            getTopics: vi.fn().mockResolvedValue([
                [
                    {
                        name: `projects/${PROJECT_ID}/topics/${TOPIC}`,
                    },
                ],
            ]),
            getSubscriptions: vi.fn().mockResolvedValue([
                [
                    {
                        name: `projects/${PROJECT_ID}/subscriptions/${SUBSCRIPTION}`,
                    },
                ],
            ]),
        }));
    });

    it('should create a message queue', async () => {
        const mq = await createMessageQueue(mockLogger, {
            topic: TOPIC,
            subscription: SUBSCRIPTION,
        });

        expect(mq).toBeInstanceOf(GCloudPubSubPushMessageQueue);

        expect(PubSub).toHaveBeenCalledWith({});
    });

    it('should create a message queue with a pubsub client that is initialised with a custom host', async () => {
        await createMessageQueue(mockLogger, {
            pubSubHost: 'https://foo.bar.baz',
            topic: TOPIC,
            subscription: SUBSCRIPTION,
        });

        expect(PubSub).toHaveBeenCalledWith({
            apiEndpoint: 'https://foo.bar.baz',
        });
    });

    it('should create a message queue with a pubsub client that will utilise an emulator', async () => {
        await createMessageQueue(mockLogger, {
            hostIsEmulator: true,
            topic: TOPIC,
            subscription: SUBSCRIPTION,
        });

        expect(PubSub).toHaveBeenCalledWith({
            emulatorMode: true,
        });
    });

    it('should create a message queue with a pubsub client that is initialised with a project ID', async () => {
        await createMessageQueue(mockLogger, {
            projectId: PROJECT_ID,
            topic: TOPIC,
            subscription: SUBSCRIPTION,
        });

        expect(PubSub).toHaveBeenCalledWith({
            projectId: PROJECT_ID,
        });
    });

    it('should throw an error if the topic does not exist', async () => {
        (PubSub as unknown as Mock).mockImplementation(() => ({
            getTopics: vi.fn().mockResolvedValue([[]]),
        }));

        await expect(
            createMessageQueue(mockLogger, {
                topic: TOPIC,
                subscription: SUBSCRIPTION,
            }),
        ).rejects.toThrow(`Topic [${TOPIC}] does not exist`);
    });

    it('should throw an error if the subscription does not exist', async () => {
        (PubSub as unknown as Mock).mockImplementation(() => ({
            projectId: PROJECT_ID,
            getTopics: vi.fn().mockResolvedValue([
                [
                    {
                        name: `projects/${PROJECT_ID}/topics/${TOPIC}`,
                    },
                ],
            ]),
            getSubscriptions: vi.fn().mockResolvedValue([[]]),
        }));

        await expect(
            createMessageQueue(mockLogger, {
                topic: TOPIC,
                subscription: SUBSCRIPTION,
            }),
        ).rejects.toThrow(`Subscription [${SUBSCRIPTION}] does not exist`);
    });
});
