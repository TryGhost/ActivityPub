import { describe, expect, it } from 'vitest';

import { PubSub } from '@google-cloud/pubsub';

import { getFullTopic, initPubSubClient } from './pubsub';

const PROJECT_ID = String(process.env.MQ_PUBSUB_PROJECT_ID);
const HOST = String(process.env.MQ_PUBSUB_HOST);
const TOPICS = [
    String(process.env.MQ_PUBSUB_TOPIC_NAME),
    String(process.env.MQ_PUBSUB_GHOST_TOPIC_NAME),
].filter(Boolean);
const SUBSCRIPTIONS = [
    String(process.env.MQ_PUBSUB_SUBSCRIPTION_NAME),
    String(process.env.MQ_PUBSUB_GHOST_SUBSCRIPTION_NAME),
].filter(Boolean);

describe('initPubSubClient', () => {
    it('should return a configured Pub/Sub client', async () => {
        const pubSubClient = await initPubSubClient({
            projectId: PROJECT_ID,
            host: HOST,
            isEmulator: true,
            topics: TOPICS,
            subscriptions: SUBSCRIPTIONS,
        });

        expect(pubSubClient).toBeInstanceOf(PubSub);
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
