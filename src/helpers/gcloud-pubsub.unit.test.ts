import { describe, expect, it, vi } from 'vitest';

import type { PubSub } from '@google-cloud/pubsub';

import {
    getFullSubscriptionIdentifier,
    getFullTopicIdentifier,
    subscriptionExists,
    topicExists,
} from './gcloud-pubsub';

const PROJECT_ID = 'foo';
const TOPIC_NAME = 'bar';
const SUBSCRIPTION_NAME = 'baz';

function getMockClient(implementation: Partial<PubSub> = {}) {
    return {
        projectId: PROJECT_ID,
        ...implementation,
    } as unknown as PubSub;
}

describe('getFullTopicIdentifier', () => {
    it('should return the correct full topic identifier', () => {
        const mockClient = getMockClient();

        const result = getFullTopicIdentifier(mockClient, TOPIC_NAME);

        expect(result).toBe(`projects/${PROJECT_ID}/topics/${TOPIC_NAME}`);
    });
});

describe('getFullSubscriptionIdentifier', () => {
    it('should return the correct full subscription identifier', () => {
        const mockClient = getMockClient();

        const result = getFullSubscriptionIdentifier(
            mockClient,
            SUBSCRIPTION_NAME,
        );

        expect(result).toBe(
            `projects/${PROJECT_ID}/subscriptions/${SUBSCRIPTION_NAME}`,
        );
    });
});

describe('topicExists', () => {
    it('should check if a topic exists', async () => {
        const topicIdentifier = `projects/${PROJECT_ID}/topics/${TOPIC_NAME}`;

        const mockClient = getMockClient({
            getTopics: vi.fn().mockResolvedValue([[{ name: topicIdentifier }]]),
        });

        const result = await topicExists(mockClient, topicIdentifier);

        expect(result).toBe(true);
    });
});

describe('subscriptionExists', () => {
    it('should check if a subscription exists', async () => {
        const subscriptionIdentifier = `projects/${PROJECT_ID}/subscriptions/${SUBSCRIPTION_NAME}`;

        const mockClient = getMockClient({
            getSubscriptions: vi
                .fn()
                .mockResolvedValue([[{ name: subscriptionIdentifier }]]),
        });

        const result = await subscriptionExists(
            mockClient,
            subscriptionIdentifier,
        );

        expect(result).toBe(true);
    });
});
