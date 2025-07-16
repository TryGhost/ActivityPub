import type { PubSub, Topic } from '@google-cloud/pubsub';
import type { Logger } from '@logtape/logtape';
import type { Context } from 'hono';
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccountService } from 'account/account.service';
import { GCloudPubSubPushMessageQueue, createPushMessageHandler } from './mq';

vi.mock('@google-cloud/pubsub', () => ({
    PubSub: vi.fn(),
}));

vi.mock('@opentelemetry/api', () => ({
    context: {
        active: vi.fn(() => ({})),
    },
    propagation: {
        inject: vi.fn(),
    },
}));

vi.mock('@sentry/node', () => ({
    startSpan: vi.fn((_options, callback) => callback()),
    continueTrace: vi.fn((_sentryTrace, callback) => callback()),
}));

describe('GCloudPubSubPushMessageQueue', () => {
    const PROJECT_ID = 'test_project';
    const TOPIC = 'test_topic';

    let mockLogger: Logger;
    let mockTopic: Topic;
    let mockPubSubClient: PubSub;
    let mockAccountService: AccountService;

    beforeEach(() => {
        mockLogger = {
            info: vi.fn(),
            error: vi.fn(),
            warn: vi.fn(),
            debug: vi.fn(),
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

        mockAccountService = {
            recordDeliveryFailure: vi.fn(),
            clearDeliveryFailure: vi.fn(),
            getActiveDeliveryBackoff: vi.fn(),
        } as unknown as AccountService;
    });

    describe('enqueue', () => {
        it('should publish a message', async () => {
            const mq = new GCloudPubSubPushMessageQueue(
                mockLogger,
                mockPubSubClient,
                mockAccountService,
                TOPIC,
            );

            const message = {
                id: 'abc123',
            };

            await mq.enqueue(message);

            expect(mockTopic.publishMessage).toHaveBeenCalledTimes(1);
            expect(mockTopic.publishMessage).toHaveBeenCalledWith({
                json: expect.objectContaining({
                    ...message,
                    traceContext: expect.any(Object),
                }),
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
                mockAccountService,
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

        it('should drop outbox messages with active backoff', async () => {
            const activeBackoff = {
                backoffUntil: new Date(Date.now() + 3600000), // 1 hour from now
                backoffSeconds: 3600,
            };

            (
                mockAccountService.getActiveDeliveryBackoff as Mock
            ).mockResolvedValue(activeBackoff);

            const mq = new GCloudPubSubPushMessageQueue(
                mockLogger,
                mockPubSubClient,
                mockAccountService,
                TOPIC,
            );

            const message = {
                id: 'abc123',
                type: 'outbox',
                inbox: 'https://example.com/inbox',
            };

            await mq.enqueue(message);

            expect(
                mockAccountService.getActiveDeliveryBackoff,
            ).toHaveBeenCalledWith(new URL('https://example.com/inbox'));
            expect(mockTopic.publishMessage).not.toHaveBeenCalled();
            expect(mockLogger.warn).toHaveBeenCalledWith(
                expect.stringContaining('Dropping message'),
                expect.objectContaining({
                    fedifyId: message.id,
                    inboxUrl: 'https://example.com/inbox',
                    backoffUntil: activeBackoff.backoffUntil.toISOString(),
                    backoffSeconds: activeBackoff.backoffSeconds,
                }),
            );
        });

        it('should enqueue outbox messages without active backoff', async () => {
            (
                mockAccountService.getActiveDeliveryBackoff as Mock
            ).mockResolvedValue(null);

            const mq = new GCloudPubSubPushMessageQueue(
                mockLogger,
                mockPubSubClient,
                mockAccountService,
                TOPIC,
            );

            const message = {
                id: 'abc123',
                type: 'outbox',
                inbox: 'https://example.com/inbox',
            };

            await mq.enqueue(message);

            expect(
                mockAccountService.getActiveDeliveryBackoff,
            ).toHaveBeenCalledWith(new URL('https://example.com/inbox'));
            expect(mockTopic.publishMessage).toHaveBeenCalledTimes(1);
        });

        it('should enqueue non-outbox messages without checking backoff', async () => {
            const mq = new GCloudPubSubPushMessageQueue(
                mockLogger,
                mockPubSubClient,
                mockAccountService,
                TOPIC,
            );

            const message = {
                id: 'abc123',
                type: 'inbox',
                inbox: 'https://example.com/inbox',
            };

            await mq.enqueue(message);

            expect(
                mockAccountService.getActiveDeliveryBackoff,
            ).not.toHaveBeenCalled();
            expect(mockTopic.publishMessage).toHaveBeenCalledTimes(1);
        });
    });

    describe('listen', () => {
        it('should return a promise that resolves when the signal is aborted', async () => {
            const mq = new GCloudPubSubPushMessageQueue(
                mockLogger,
                mockPubSubClient,
                mockAccountService,
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
                mockAccountService,
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
                mockAccountService,
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
                attributes: {
                    fedifyId: 'abc123',
                },
            });

            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler).toHaveBeenCalledWith(messageData);
        });

        it('should return a promise that rejects if the handler throws an error', async () => {
            const mq = new GCloudPubSubPushMessageQueue(
                mockLogger,
                mockPubSubClient,
                mockAccountService,
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
                    attributes: {
                        fedifyId: 'abc123',
                    },
                }),
            ).rejects.toThrow(error);
        });

        it('should return a promise that rejects if the message queue is not listening', async () => {
            const mq = new GCloudPubSubPushMessageQueue(
                mockLogger,
                mockPubSubClient,
                mockAccountService,
                TOPIC,
            );

            await expect(
                mq.handleMessage({
                    id: 'abc123',
                    data: {
                        id: 'abc123',
                    },
                    attributes: {
                        fedifyId: 'abc123',
                    },
                }),
            ).rejects.toThrow(
                'Message queue is not listening, cannot handle message',
            );
        });

        it('should execute the error listener if an error occurs', async () => {
            const mq = new GCloudPubSubPushMessageQueue(
                mockLogger,
                mockPubSubClient,
                mockAccountService,
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
                    attributes: {
                        fedifyId: 'abc123',
                    },
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
                mockAccountService,
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
                attributes: {
                    fedifyId: 'abc123',
                },
            });

            expect(mockRetryTopic.publishMessage).toHaveBeenCalledTimes(1);
            expect(mockRetryTopic.publishMessage).toHaveBeenCalledWith({
                json: {
                    id: 'abc123',
                },
                attributes: {
                    fedifyId: 'abc123',
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
                mockAccountService,
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
                attributes: {
                    fedifyId: 'abc123',
                },
            });

            expect(mockRetryTopic.publishMessage).not.toHaveBeenCalled();
        });

        it('should report an error if the error classified as reportable', async () => {
            const mq = new GCloudPubSubPushMessageQueue(
                mockLogger,
                mockPubSubClient,
                mockAccountService,
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

        it('should handle permanent failures for non-retryable errors', async () => {
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
                mockAccountService,
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
                    type: 'outbox',
                    inbox: 'https://other.com/inbox',
                },
                attributes: {
                    fedifyId: 'abc123',
                },
            });

            expect(
                mockAccountService.recordDeliveryFailure,
            ).toHaveBeenCalledWith(
                new URL('https://other.com/inbox'),
                error.message,
            );
        });

        it('should not record a delivery failure when the message type is not outbox', async () => {
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
                mockAccountService,
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
                    type: 'inbox',
                    inbox: 'https://other.com/inbox',
                },
                attributes: {
                    fedifyId: 'abc123',
                },
            });

            expect(
                mockAccountService.recordDeliveryFailure,
            ).not.toHaveBeenCalled();
        });

        it('should not record a delivery failure when the message inbox is not a string', async () => {
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
                mockAccountService,
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
                    type: 'outbox',
                    inbox: { url: 'https://other.com/inbox' },
                },
                attributes: {
                    fedifyId: 'abc123',
                },
            });

            expect(
                mockAccountService.recordDeliveryFailure,
            ).not.toHaveBeenCalled();
        });

        it('should clear delivery failure on successful message handling', async () => {
            const mq = new GCloudPubSubPushMessageQueue(
                mockLogger,
                mockPubSubClient,
                mockAccountService,
                TOPIC,
            );

            const handler = vi.fn().mockResolvedValue(undefined);

            mq.listen(handler);

            await mq.handleMessage({
                id: 'abc123',
                data: {
                    id: 'abc123',
                    type: 'outbox',
                    inbox: 'https://other.com/inbox',
                },
                attributes: {
                    fedifyId: 'abc123',
                },
            });

            expect(handler).toHaveBeenCalledWith({
                id: 'abc123',
                type: 'outbox',
                inbox: 'https://other.com/inbox',
            });
            expect(
                mockAccountService.clearDeliveryFailure,
            ).toHaveBeenCalledWith(new URL('https://other.com/inbox'));
        });

        it('should not clear delivery failure when the message type is not outbox', async () => {
            const mq = new GCloudPubSubPushMessageQueue(
                mockLogger,
                mockPubSubClient,
                mockAccountService,
                TOPIC,
            );

            const handler = vi.fn().mockResolvedValue(undefined);

            mq.listen(handler);

            await mq.handleMessage({
                id: 'abc123',
                data: {
                    id: 'abc123',
                    type: 'inbox',
                    inbox: 'https://other.com/inbox',
                },
                attributes: {
                    fedifyId: 'abc123',
                },
            });

            expect(handler).toHaveBeenCalledWith({
                id: 'abc123',
                type: 'inbox',
                inbox: 'https://other.com/inbox',
            });
            expect(
                mockAccountService.clearDeliveryFailure,
            ).not.toHaveBeenCalled();
        });

        it('should not clear delivery failure when the message inbox is not a string', async () => {
            const mq = new GCloudPubSubPushMessageQueue(
                mockLogger,
                mockPubSubClient,
                mockAccountService,
                TOPIC,
            );

            const handler = vi.fn().mockResolvedValue(undefined);

            mq.listen(handler);

            await mq.handleMessage({
                id: 'abc123',
                data: {
                    id: 'abc123',
                    type: 'outbox',
                    inbox: { url: 'https://other.com/inbox' },
                },
                attributes: {
                    fedifyId: 'abc123',
                },
            });

            expect(handler).toHaveBeenCalledWith({
                id: 'abc123',
                type: 'outbox',
                inbox: { url: 'https://other.com/inbox' },
            });
            expect(
                mockAccountService.clearDeliveryFailure,
            ).not.toHaveBeenCalled();
        });

        it('should not try and handle a retryable error as a permanent failure', async () => {
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
                mockAccountService,
                TOPIC,
                true,
                RETRY_TOPIC,
            );

            // This is a retryable error (500 status code)
            const error = new Error(
                'Failed to send activity https://example.com/activity/123 to https://other.com/inbox (500 Internal Server Error):\nServer Error',
            );

            const handler = vi.fn().mockRejectedValue(error);

            mq.listen(handler);

            await mq.handleMessage({
                id: 'abc123',
                data: {
                    id: 'abc123',
                    type: 'outbox',
                    inbox: 'https://other.com/inbox',
                },
                attributes: {
                    fedifyId: 'abc123',
                },
            });

            // Should publish to retry topic for retryable errors
            expect(mockRetryTopic.publishMessage).toHaveBeenCalledTimes(1);
            expect(mockRetryTopic.publishMessage).toHaveBeenCalledWith({
                json: {
                    id: 'abc123',
                    type: 'outbox',
                    inbox: 'https://other.com/inbox',
                },
                attributes: {
                    fedifyId: 'abc123',
                },
            });

            // Should NOT call permanent failure handling for retryable errors
            expect(
                mockAccountService.recordDeliveryFailure,
            ).not.toHaveBeenCalled();
        });
    });
});

describe('handlePushMessage', () => {
    const PROJECT_ID = 'test_project';
    const TOPIC = 'test_topic';

    let ctx: Context;
    let mockLogger: Logger;
    let mockPubSubClient: PubSub;
    let mockAccountService: AccountService;

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
            debug: vi.fn(),
        } as unknown as Logger;

        mockPubSubClient = {
            projectId: PROJECT_ID,
        } as unknown as PubSub;

        mockAccountService = {
            recordDeliveryFailure: vi.fn(),
            clearDeliveryFailure: vi.fn(),
            getActiveDeliveryBackoff: vi.fn(),
        } as unknown as AccountService;
    });

    it('should return a 429 response if the message queue is not listening', async () => {
        const mq = new GCloudPubSubPushMessageQueue(
            mockLogger,
            mockPubSubClient,
            mockAccountService,
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
            mockAccountService,
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
            mockAccountService,
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
            mockAccountService,
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
            mockAccountService,
            TOPIC,
        );

        mq.listen(
            vi.fn().mockRejectedValue(new Error('Failed to handle message')),
        );

        const handlePushMessage = createPushMessageHandler(mq, mockLogger);

        const result = await handlePushMessage(ctx);

        expect(result.status).toBe(500);
    });

    it('should handle messages with tracing context', async () => {
        const mq = new GCloudPubSubPushMessageQueue(
            mockLogger,
            mockPubSubClient,
            mockAccountService,
            TOPIC,
        );

        const messageData = {
            id: 'abc123',
            traceContext: {
                'sentry-trace': 'trace-123',
                baggage: 'baggage-data',
            },
        };

        (ctx.req.json as Mock).mockResolvedValue({
            message: {
                message_id: 'abc123',
                data: Buffer.from(JSON.stringify(messageData)).toString(
                    'base64',
                ),
                attributes: {
                    fedifyId: 'abc123',
                },
            },
        });

        const handler = vi.fn().mockResolvedValue(undefined);
        mq.listen(handler);

        const handlePushMessage = createPushMessageHandler(mq, mockLogger);

        const result = await handlePushMessage(ctx);

        expect(result.status).toBe(200);
        expect(handler).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'abc123',
                traceContext: expect.any(Object),
            }),
        );
    });
});
