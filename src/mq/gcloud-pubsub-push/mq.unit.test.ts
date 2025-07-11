import type { PubSub, Topic } from '@google-cloud/pubsub';
import type { Logger } from '@logtape/logtape';
import type { Context } from 'hono';
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';

import { GCloudPubSubPushMessageQueue, createPushMessageHandler } from './mq';

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
                id: 'abc123',
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
                    data: {
                        id: 'abc123',
                    },
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
                    data: {
                        id: 'abc123',
                    },
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
                    data: {
                        id: 'abc123',
                    },
                    attributes: {},
                }),
            ).rejects.toThrow(error);

            expect(errorListener).toHaveBeenCalledTimes(1);
            expect(errorListener).toHaveBeenCalledWith(error);
        });

        it('should publish to the retry topic if the useRetryTopic flag is true and the error is classified as retryable', async () => {
            const RETRY_TOPIC = 'retry-topic';

            const mockRetryTopic = {
                publishMessage: vi.fn(),
            } as unknown as Topic;

            mockPubSubClient = {
                projectId: PROJECT_ID,
                topic: vi.fn((topic) => {
                    if (topic === RETRY_TOPIC) {
                        return mockRetryTopic;
                    }

                    throw new Error(`Unexpected topic: ${topic}`);
                }),
            } as unknown as PubSub;

            const mq = new GCloudPubSubPushMessageQueue(
                mockLogger,
                mockPubSubClient,
                TOPIC,
                true,
                RETRY_TOPIC,
            );

            const error = new Error('Failed to handle message');
            const handler = vi.fn().mockRejectedValue(error);

            mq.listen(handler);

            await mq.handleMessage({
                id: 'abc123',
                data: {
                    id: 'abc123',
                },
                attributes: {},
            });

            expect(mockRetryTopic.publishMessage).toHaveBeenCalledTimes(1);
            expect(mockRetryTopic.publishMessage).toHaveBeenCalledWith({
                json: {
                    id: 'abc123',
                },
                attributes: {
                    fedifyId: 'unknown',
                },
            });
        });

        it('should not publish to the retry topic if the useRetryTopic flag is true and the error is classified as non-retryable', async () => {
            const RETRY_TOPIC = 'retry-topic';

            const mockRetryTopic = {
                publishMessage: vi.fn(),
            } as unknown as Topic;

            mockPubSubClient = {
                projectId: PROJECT_ID,
                topic: vi.fn((topic) => {
                    if (topic === RETRY_TOPIC) {
                        return mockRetryTopic;
                    }

                    throw new Error(`Unexpected topic: ${topic}`);
                }),
            } as unknown as PubSub;

            const mq = new GCloudPubSubPushMessageQueue(
                mockLogger,
                mockPubSubClient,
                TOPIC,
                true,
                RETRY_TOPIC,
            );

            const error = new Error(
                'Failed to send activity https://example.com/activity/123 to https://other.com/inbox (403 Forbidden):\nForbidden',
            );

            const handler = vi.fn().mockRejectedValue(error);

            mq.listen(handler);

            await mq.handleMessage({
                id: 'abc123',
                data: {
                    id: 'abc123',
                },
                attributes: {},
            });

            expect(mockRetryTopic.publishMessage).not.toHaveBeenCalled();
        });

        it('should report an error if the error classified as reportable', async () => {
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

            try {
                await mq.handleMessage({
                    id: 'abc123',
                    data: {
                        id: 'abc123',
                    },
                    attributes: {},
                });

                throw new Error('Expected error to be thrown');
            } catch (err) {
                expect(errorListener).toHaveBeenCalledTimes(1);
                expect(errorListener).toHaveBeenCalledWith(err);
            }
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

    it('should return a 429 response if the message queue is not listening', async () => {
        const mq = new GCloudPubSubPushMessageQueue(
            mockLogger,
            mockPubSubClient,
            TOPIC,
        );

        const handlePushMessage = createPushMessageHandler(mq, mockLogger);

        const result = await handlePushMessage(ctx);

        expect(result.status).toBe(429);
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

        const handlePushMessage = createPushMessageHandler(mq, mockLogger);

        const result = await handlePushMessage(ctx);

        expect(result.status).toBe(400);
    });

    it('should return a 400 response if the incoming message data cannot be parsed', async () => {
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

        const handlePushMessage = createPushMessageHandler(mq, mockLogger);

        const result = await handlePushMessage(ctx);

        expect(result.status).toBe(400);
    });

    it('should return a 200 response if the incoming message is successfully handled', async () => {
        const mq = new GCloudPubSubPushMessageQueue(
            mockLogger,
            mockPubSubClient,
            TOPIC,
        );

        mq.listen(vi.fn().mockResolvedValue(undefined));

        const handlePushMessage = createPushMessageHandler(mq, mockLogger);

        const result = await handlePushMessage(ctx);

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

        const handlePushMessage = createPushMessageHandler(mq, mockLogger);

        const result = await handlePushMessage(ctx);

        expect(result.status).toBe(500);
    });
});
