import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { PubSub, type Subscription } from '@google-cloud/pubsub';

import { GCloudPubSubPushMessageBus } from './gcloud-pubsub-push-message-bus';

describe('GCloudPubSubPushMessageBus', () => {
    let pubSubClient: PubSub;
    let bus: GCloudPubSubPushMessageBus;
    let subscription: Subscription;

    beforeAll(async () => {
        pubSubClient = new PubSub({
            apiEndpoint: process.env.MQ_PUBSUB_HOST,
            emulatorMode: true,
            projectId: process.env.MQ_PUBSUB_PROJECT_ID,
        });
        [subscription] = await pubSubClient.createSubscription(
            process.env.MQ_PUBSUB_GHOST_TOPIC_NAME!,
            `${process.env.MQ_PUBSUB_GHOST_SUBSCRIPTION_NAME}-test-${Date.now()}`,
        );
    });

    beforeEach(async () => {
        bus = new GCloudPubSubPushMessageBus(
            pubSubClient,
            process.env.MQ_PUBSUB_GHOST_TOPIC_NAME!,
        );
    });

    it('should publish a message', async () => {
        let message: { data: Buffer } | undefined;

        subscription.on('message', (_message) => {
            message = _message;
        });

        const eventName = 'foo';
        const eventData = {
            bar: 'baz',
        };

        const messageId = await bus.publishMessage({
            type: 'event',
            name: eventName,
            data: eventData,
        });

        await vi.waitUntil(() => message !== undefined);

        expect(message).toHaveProperty('data');

        const messageData = JSON.parse(message!.data.toString());

        expect(messageData).toMatchObject({
            type: 'event',
            name: eventName,
            data: eventData,
        });

        expect(messageId).toBeTypeOf('string');
        expect(messageId).not.toBe('');
    });

    it('should handle a message', async () => {
        const eventName = 'foo';
        const eventData = {
            bar: 'baz',
        };

        const handler = vi.fn();

        bus.registerMessageHandler('event', eventName, handler);

        await bus.handleMessage({
            type: 'event',
            name: eventName,
            data: eventData,
        });

        await vi.waitUntil(() => handler.mock.calls.length > 0);

        expect(handler).toHaveBeenCalledWith({
            type: 'event',
            name: eventName,
            data: eventData,
        });
    });

    it('should handle a message with multiple handlers', async () => {
        const eventName = 'foo';
        const eventData = {
            bar: 'baz',
        };

        const handler1 = vi.fn();
        const handler2 = vi.fn();

        bus.registerMessageHandler('event', eventName, handler1);
        bus.registerMessageHandler('event', eventName, handler2);

        await bus.handleMessage({
            type: 'event',
            name: eventName,
            data: eventData,
        });

        await vi.waitUntil(() => handler1.mock.calls.length > 0);
        await vi.waitUntil(() => handler2.mock.calls.length > 0);

        expect(handler1).toHaveBeenCalledWith({
            type: 'event',
            name: eventName,
            data: eventData,
        });

        expect(handler2).toHaveBeenCalledWith({
            type: 'event',
            name: eventName,
            data: eventData,
        });
    });

    it('should only allow one command message handler per command', () => {
        const commandName = 'foo';

        bus.registerMessageHandler('command', commandName, vi.fn());

        expect(() =>
            bus.registerMessageHandler('command', commandName, vi.fn()),
        ).toThrow(`Handler for command "${commandName}" already registered`);
    });
});
