import type {
    Message,
    PubSub,
    Subscription,
    Topic,
} from '@google-cloud/pubsub';
import { Temporal } from '@js-temporal/polyfill';
import type { Logger } from '@logtape/logtape';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GCloudPubSubMessageQueue } from './gcloud-pubsub-mq';

const TOPIC_IDENTIFIER = 'topic';
const SUBSCRIPTION_IDENTIFIER = 'subscription';

describe('enqueue', () => {
    const MESSAGE = { id: 'abc123' };
    const MOCK_MESSAGE_ID = 'def789';

    let mockLogger: Logger;
    let mockTopic: Topic;
    let mockPubSubClient: PubSub;
    let messageQueue: GCloudPubSubMessageQueue;

    beforeAll(() => {
        vi.useFakeTimers();
    });

    beforeEach(() => {
        mockLogger = {
            info: vi.fn(),
            error: vi.fn(),
        } as unknown as Logger;

        mockTopic = {
            publishMessage: vi.fn().mockResolvedValue(MOCK_MESSAGE_ID),
        } as unknown as Topic;

        mockPubSubClient = {
            topic: vi.fn().mockImplementation((identifier) => {
                if (identifier === TOPIC_IDENTIFIER) {
                    return mockTopic;
                }
                throw new Error('Unexpected topic identifier');
            }),
        } as unknown as PubSub;

        messageQueue = new GCloudPubSubMessageQueue(
            mockPubSubClient,
            TOPIC_IDENTIFIER,
            SUBSCRIPTION_IDENTIFIER,
            mockLogger,
        );
    });

    it('should publish a message without a delay', async () => {
        const enqueuePromise = messageQueue.enqueue(MESSAGE);

        vi.runAllTimers();
        await enqueuePromise;

        expect(mockLogger.info).toHaveBeenCalledWith(
            `Enqueuing message [FedifyID: ${MESSAGE.id}] with delay: 0ms`,
        );
        expect(mockPubSubClient.topic).toHaveBeenCalledWith(TOPIC_IDENTIFIER);
        expect(mockTopic.publishMessage).toHaveBeenCalledWith({
            json: MESSAGE,
            attributes: { fedifyId: MESSAGE.id },
        });
        expect(mockLogger.info).toHaveBeenCalledWith(
            `Message [FedifyID: ${MESSAGE.id}] was enqueued [PubSubID: ${MOCK_MESSAGE_ID}]`,
        );
    });

    it('should publish a message with a delay', async () => {
        const delayMs = 1000;
        const enqueuePromise = messageQueue.enqueue(MESSAGE, {
            delay: Temporal.Duration.from({ milliseconds: delayMs }),
        });

        vi.advanceTimersByTime(delayMs);
        await enqueuePromise;

        expect(mockLogger.info).toHaveBeenCalledWith(
            `Enqueuing message [FedifyID: ${MESSAGE.id}] with delay: ${delayMs}ms`,
        );
        expect(mockPubSubClient.topic).toHaveBeenCalledWith(TOPIC_IDENTIFIER);
        expect(mockTopic.publishMessage).toHaveBeenCalledWith({
            json: MESSAGE,
            attributes: { fedifyId: MESSAGE.id },
        });
        expect(mockLogger.info).toHaveBeenCalledWith(
            `Message [FedifyID: ${MESSAGE.id}] was enqueued [PubSubID: ${MOCK_MESSAGE_ID}]`,
        );
    });

    it('should throw an error and log if the message fails to be published', async () => {
        const error = new Error('Failed to publish message');

        mockTopic.publishMessage = vi.fn().mockRejectedValue(error);

        const enqueuePromise = messageQueue.enqueue(MESSAGE);

        vi.runAllTimers();
        await expect(enqueuePromise).rejects.toThrow(error);

        expect(mockLogger.error).toHaveBeenCalledWith(
            `Failed to enqueue message [FedifyID: ${MESSAGE.id}]: Error: Failed to publish message`,
        );
        expect(mockPubSubClient.topic).toHaveBeenCalledWith(TOPIC_IDENTIFIER);
        expect(mockTopic.publishMessage).toHaveBeenCalledWith({
            json: MESSAGE,
            attributes: { fedifyId: MESSAGE.id },
        });
    });
});

describe('listen', () => {
    const MESSAGE_DATA = { foo: 'bar' };
    const MESSAGE = {
        id: 'abc123',
        attributes: {
            fedifyId: 'def789',
        },
        data: Buffer.from(JSON.stringify(MESSAGE_DATA)),
        ack: vi.fn(),
        nack: vi.fn(),
    } as unknown as Message;

    let mockLogger: Logger;
    let mockSubscription: Subscription;
    let mockPubSubClient: PubSub;
    let messageQueue: GCloudPubSubMessageQueue;

    beforeEach(() => {
        mockLogger = {
            info: vi.fn(),
            error: vi.fn(),
        } as unknown as Logger;

        mockSubscription = {
            on: vi
                .fn()
                .mockImplementation(
                    (event: string, callback: (message: Message) => void) => {
                        if (event === 'message') {
                            callback(MESSAGE);
                        }
                        return mockSubscription;
                    },
                ),
            removeAllListeners: vi.fn().mockReturnThis(),
            close: vi.fn().mockResolvedValue(undefined),
        } as unknown as Subscription;

        mockPubSubClient = {
            subscription: vi.fn().mockImplementation((identifier) => {
                if (identifier === SUBSCRIPTION_IDENTIFIER) {
                    return mockSubscription;
                }
                throw new Error('Unexpected subscription identifier');
            }),
        } as unknown as PubSub;

        messageQueue = new GCloudPubSubMessageQueue(
            mockPubSubClient,
            TOPIC_IDENTIFIER,
            SUBSCRIPTION_IDENTIFIER,
            mockLogger,
        );
    });

    it('should handle and acknowledge a message', async () => {
        const abortController = new AbortController();
        const handler = vi.fn().mockResolvedValue(undefined);

        const listenPromise = messageQueue.listen(handler, {
            signal: abortController.signal,
        });

        abortController.abort();
        await listenPromise;

        expect(handler).toHaveBeenCalledWith(MESSAGE_DATA);
        expect(MESSAGE.ack).toHaveBeenCalled();
        expect(mockLogger.info).toHaveBeenCalledWith(
            `Handling message [FedifyID: ${MESSAGE.attributes.fedifyId}, PubSubID: ${MESSAGE.id}]`,
        );
        expect(mockLogger.info).toHaveBeenCalledWith(
            `Acknowledged message [FedifyID: ${MESSAGE.attributes.fedifyId}, PubSubID: ${MESSAGE.id}]`,
        );
    });

    it('should log an error and nack the message if message handling fails', async () => {
        const abortController = new AbortController();
        const handler = vi
            .fn()
            .mockRejectedValue(new Error('Failed to handle message'));

        const listenPromise = messageQueue.listen(handler, {
            signal: abortController.signal,
        });

        abortController.abort();
        await listenPromise;

        expect(handler).toHaveBeenCalledWith(MESSAGE_DATA);
        expect(MESSAGE.nack).toHaveBeenCalled();
        expect(mockLogger.info).toHaveBeenCalledWith(
            `Handling message [FedifyID: ${MESSAGE.attributes.fedifyId}, PubSubID: ${MESSAGE.id}]`,
        );
        expect(mockLogger.error).toHaveBeenCalledWith(
            `Failed to handle message [FedifyID: ${MESSAGE.attributes.fedifyId}, PubSubID: ${MESSAGE.id}]: Error: Failed to handle message`,
        );
    });

    it('should clean up the subscription when the abort signal is triggered', async () => {
        const abortController = new AbortController();
        const handler = vi.fn();

        const listenPromise = messageQueue.listen(handler, {
            signal: abortController.signal,
        });

        abortController.abort();
        await listenPromise;

        expect(mockSubscription.removeAllListeners).toHaveBeenCalled();
        expect(mockSubscription.close).toHaveBeenCalled();
    });
});
