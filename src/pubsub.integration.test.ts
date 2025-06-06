import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';

import { PubSub } from '@google-cloud/pubsub';

import { getFullTopic, initPubSubClient } from './pubsub';

vi.mock('@google-cloud/pubsub', () => ({
    PubSub: vi.fn(),
}));

const PROJECT_ID = 'test-project';
const HOST = 'test-host';
const TOPICS = ['test-topic-1', 'test-topic-2'];
const SUBSCRIPTIONS = ['test-subscription-1', 'test-subscription-2'];

describe('initPubSubClient', () => {
    let mockPubSubClient: Partial<PubSub>;

    beforeEach(() => {
        mockPubSubClient = {
            projectId: PROJECT_ID,
            getTopics: vi.fn().mockResolvedValue([
                [
                    {
                        name: `projects/${PROJECT_ID}/topics/${TOPICS[0]}`,
                    },
                    {
                        name: `projects/${PROJECT_ID}/topics/${TOPICS[1]}`,
                    },
                ],
            ]),
            getSubscriptions: vi.fn().mockResolvedValue([
                [
                    {
                        name: `projects/${PROJECT_ID}/subscriptions/${SUBSCRIPTIONS[0]}`,
                    },
                    {
                        name: `projects/${PROJECT_ID}/subscriptions/${SUBSCRIPTIONS[1]}`,
                    },
                ],
            ]),
        };

        (PubSub as unknown as Mock).mockImplementation(() => mockPubSubClient);
    });

    it('should return a configured Pub/Sub client', async () => {
        const pubSubClient = await initPubSubClient({
            projectId: PROJECT_ID,
            host: HOST,
            isEmulator: true,
            topics: TOPICS,
            subscriptions: SUBSCRIPTIONS,
        });

        expect(PubSub).toHaveBeenCalledWith({
            apiEndpoint: HOST,
            emulatorMode: true,
            projectId: PROJECT_ID,
        });

        expect(pubSubClient).toBe(mockPubSubClient);
    });

    it('should throw an error if a topic does not exist', async () => {
        await expect(
            initPubSubClient({
                projectId: PROJECT_ID,
                host: HOST,
                isEmulator: true,
                topics: ['non-existent-topic'],
                subscriptions: SUBSCRIPTIONS,
            }),
        ).rejects.toThrow('Topic [non-existent-topic] does not exist');
    });

    it('should throw an error if a subscription does not exist', async () => {
        await expect(
            initPubSubClient({
                projectId: PROJECT_ID,
                host: HOST,
                isEmulator: true,
                topics: TOPICS,
                subscriptions: ['non-existent-subscription'],
            }),
        ).rejects.toThrow(
            'Subscription [non-existent-subscription] does not exist',
        );
    });
});

describe('getFullTopic', () => {
    it('should return the full topic name', () => {
        const fullTopic = getFullTopic('foo', 'bar');

        expect(fullTopic).toBe('projects/foo/topics/bar');
    });
});
