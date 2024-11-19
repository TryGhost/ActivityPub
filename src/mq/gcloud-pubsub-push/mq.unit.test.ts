import { PubSub, type Topic } from '@google-cloud/pubsub';
import { Temporal } from '@js-temporal/polyfill';
import type { Logger } from '@logtape/logtape';
import type { Context } from 'hono';
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    GCloudPubSubPushMessageQueue,
    createMessageQueue,
    handlePushMessage,
} from './mq';

vi.mock('@google-cloud/pubsub', () => ({
    PubSub: vi.fn(),
}));

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
                if (topic === TOPIC) {
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

            const promise = mq.listen(vi.fn(), {
                signal: abortController.signal,
            });

            abortController.abort();

            await expect(promise).resolves.toBeUndefined();
        });

        it('should set that the message queue is listening', async () => {
            const mq = new GCloudPubSubPushMessageQueue(
                mockLogger,
                mockPubSubClient,
                TOPIC,
            );

            expect(mq.isListening).toBe(false);

            const abortController = new AbortController();

            const promise = mq.listen(vi.fn(), {
                signal: abortController.signal,
            });

            expect(mq.isListening).toBe(true);

            abortController.abort();

            await promise;

            expect(mq.isListening).toBe(false);
        });
    });

    describe('handleMessage', () => {
        it('should return a promise that resolves when the message is handled', async () => {
            const mq = new GCloudPubSubPushMessageQueue(
                mockLogger,
                mockPubSubClient,
                TOPIC,
            );

            const handler = vi.fn();

            mq.listen(handler);

            const messageData = {
                foo: 'bar',
            };

            await mq.handleMessage({
                id: 'abc123',
                data: messageData,
                attributes: {},
            });

            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler).toHaveBeenCalledWith(messageData);
        });

        it('should return a promise that rejects if the handler throws an error', async () => {
            const mq = new GCloudPubSubPushMessageQueue(
                mockLogger,
                mockPubSubClient,
                TOPIC,
            );

            const error = new Error('Failed to handle message');

            const handler = vi.fn().mockRejectedValue(error);

            mq.listen(handler);

            await expect(
                mq.handleMessage({
                    id: 'abc123',
                    data: {},
                    attributes: {},
                }),
            ).rejects.toThrow(error);
        });

        it('should return a promise that rejects if the message queue is not listening', async () => {
            const mq = new GCloudPubSubPushMessageQueue(
                mockLogger,
                mockPubSubClient,
                TOPIC,
            );

            await expect(
                mq.handleMessage({
                    id: 'abc123',
                    data: {},
                    attributes: {},
                }),
            ).rejects.toThrow(
                'Message queue is not listening, cannot handle message',
            );
        });

        it('should execute the error listener if an error occurs', async () => {
            const mq = new GCloudPubSubPushMessageQueue(
                mockLogger,
                mockPubSubClient,
                TOPIC,
            );

            const errorListener = vi.fn();
            mq.registerErrorListener(errorListener);

            const error = new Error('Failed to handle message');
            const handler = vi.fn().mockRejectedValue(error);
            mq.listen(handler);

            await expect(
                mq.handleMessage({
                    id: 'abc123',
                    data: {},
                    attributes: {},
                }),
            ).rejects.toThrow(error);

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
                json: vi.fn().mockResolvedValue({
                    message: {
                        message_id: 'abc123',
                        data: Buffer.from(
                            JSON.stringify({ id: 'abc123' }),
                        ).toString('base64'),
                        attributes: {},
                    },
                }),
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

    it('should return a 400 response if the incoming message data is invalid', async () => {
        const mq = new GCloudPubSubPushMessageQueue(
            mockLogger,
            mockPubSubClient,
            TOPIC,
        );

        (ctx.req.json as Mock).mockResolvedValue({
            foo: 'bar',
        });

        mq.listen(vi.fn());

        const result = await handlePushMessage(mq)(ctx);

        expect(result.status).toBe(400);
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

        (ctx.req.json as Mock).mockResolvedValue({
            message: {
                message_id: 'abc123',
                data: 'definitely not base64 encoded json',
                attributes: {},
            },
        });

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
