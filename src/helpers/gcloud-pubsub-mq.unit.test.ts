import { PubSub, type Subscription, type Topic } from '@google-cloud/pubsub';
import type { Logger } from '@logtape/logtape';
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { GCloudPubSubMessageQueue } from '../fedify/mq/gcloud-pubsub-mq';
import {
    getFullSubscriptionIdentifier,
    getFullTopicIdentifier,
    initGCloudPubSubMessageQueue,
} from './gcloud-pubsub-mq';

vi.mock('@google-cloud/pubsub', () => {
    return {
        PubSub: vi.fn(),
    };
});

vi.mock('../fedify/mq/gcloud-pubsub-mq', () => {
    return {
        GCloudPubSubMessageQueue: vi.fn(),
    };
});

describe('initGCloudPubSubMessageQueue', () => {
    let mockLogger: Logger;

    beforeEach(() => {
        mockLogger = {
            info: vi.fn(),
        } as unknown as Logger;

        vi.resetAllMocks();
    });

    it('should return a configured GCloudPubSubMessageQueue instance', async () => {
        const options = {
            host: 'foo',
            emulatorMode: true,
            projectId: 'bar',
            topicName: 'baz',
            subscriptionName: 'qux',
        };
        const topics: Topic[] = [
            {
                name: getFullTopicIdentifier(
                    options.projectId,
                    options.topicName,
                ),
            } as Topic,
        ];
        const subscriptions: Subscription[] = [
            {
                name: getFullSubscriptionIdentifier(
                    options.projectId,
                    options.subscriptionName,
                ),
            } as Subscription,
        ];

        (vi.mocked(PubSub) as Mock).mockImplementation(() => {
            return {
                getTopics: vi.fn().mockResolvedValue([topics]),
                getSubscriptions: vi.fn().mockResolvedValue([subscriptions]),
            };
        });

        await expect(
            initGCloudPubSubMessageQueue(options, mockLogger),
        ).resolves.toBeInstanceOf(GCloudPubSubMessageQueue);

        expect(PubSub).toHaveBeenCalledWith({
            projectId: options.projectId,
            apiEndpoint: options.host,
            emulatorMode: options.emulatorMode,
        });

        expect(GCloudPubSubMessageQueue).toHaveBeenCalledWith(
            expect.any(Object),
            getFullTopicIdentifier(options.projectId, options.topicName),
            getFullSubscriptionIdentifier(
                options.projectId,
                options.subscriptionName,
            ),
            mockLogger,
        );
    });

    it('should throw an error if the topic does not exist', async () => {
        const options = {
            host: 'foo',
            emulatorMode: true,
            projectId: 'bar',
            topicName: 'baz',
            subscriptionName: 'qux',
        };
        const topics: Topic[] = [];

        (vi.mocked(PubSub) as Mock).mockImplementation(() => {
            return {
                getTopics: vi.fn().mockResolvedValue([topics]),
            };
        });

        await expect(
            initGCloudPubSubMessageQueue(options, mockLogger),
        ).rejects.toThrow(`Topic does not exist: ${options.topicName}`);
    });

    it('should throw an error if the subscription does not exist', async () => {
        const options = {
            host: 'foo',
            emulatorMode: true,
            projectId: 'bar',
            topicName: 'baz',
            subscriptionName: 'qux',
        };
        const topics: Topic[] = [
            {
                name: getFullTopicIdentifier(
                    options.projectId,
                    options.topicName,
                ),
            } as Topic,
        ];
        const subscriptions: Subscription[] = [];

        (vi.mocked(PubSub) as Mock).mockImplementation(() => {
            return {
                getTopics: vi.fn().mockResolvedValue([topics]),
                getSubscriptions: vi.fn().mockResolvedValue([subscriptions]),
            };
        });

        await expect(
            initGCloudPubSubMessageQueue(options, mockLogger),
        ).rejects.toThrow(
            `Subscription does not exist: ${options.subscriptionName}`,
        );
    });
});
