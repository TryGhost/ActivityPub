import type { EventEmitter } from 'node:events';
import { PubSub, type Subscription, type Topic } from '@google-cloud/pubsub';
import type { Logger } from '@logtape/logtape';
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';

import { GCloudPubSubMessageQueue } from '../mq/gcloud-pubsub-mq';
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

vi.mock('../mq/gcloud-pubsub-mq', () => {
    return {
        GCloudPubSubMessageQueue: vi.fn(),
    };
});

const EVENT_NAME = 'event';

describe('initGCloudPubSubMessageQueue', () => {
    let mockLogger: Logger;
    let mockEventBus: EventEmitter;

    beforeEach(() => {
        mockLogger = {
            info: vi.fn(),
        } as unknown as Logger;

        mockEventBus = {
            on: vi.fn(),
        } as unknown as EventEmitter;

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
            initGCloudPubSubMessageQueue(
                mockLogger,
                mockEventBus,
                EVENT_NAME,
                options,
            ),
        ).resolves.toBeInstanceOf(GCloudPubSubMessageQueue);

        expect(PubSub).toHaveBeenCalledWith({
            projectId: options.projectId,
            apiEndpoint: options.host,
            emulatorMode: options.emulatorMode,
        });

        expect(GCloudPubSubMessageQueue).toHaveBeenCalledWith(
            expect.any(Object),
            mockEventBus,
            mockLogger,
            getFullTopicIdentifier(options.projectId, options.topicName),
            getFullSubscriptionIdentifier(
                options.projectId,
                options.subscriptionName,
            ),
            EVENT_NAME,
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
            initGCloudPubSubMessageQueue(
                mockLogger,
                mockEventBus,
                EVENT_NAME,
                options,
            ),
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
            initGCloudPubSubMessageQueue(
                mockLogger,
                mockEventBus,
                EVENT_NAME,
                options,
            ),
        ).rejects.toThrow(
            `Subscription does not exist: ${options.subscriptionName}`,
        );
    });
});
