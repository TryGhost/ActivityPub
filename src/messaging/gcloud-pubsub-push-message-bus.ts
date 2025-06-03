import { type ClientConfig, PubSub } from '@google-cloud/pubsub';
import type { Context } from 'hono';
import { z } from 'zod';

import { type Message, type MessageBus, MessageSchema } from './message-bus';

export class GCloudPubSubPushMessageBus implements MessageBus {
    private handlers: Map<string, Array<(message: Message) => void>> =
        new Map();

    constructor(
        private readonly pubSubClient: PubSub,
        private readonly topic: string,
    ) {}

    async publishMessage(message: Message) {
        return this.pubSubClient.topic(this.topic).publishMessage({
            json: message,
        });
    }

    registerMessageHandler(
        type: 'event' | 'command',
        name: string,
        handler: (message: Message) => void,
    ) {
        const key = this.getMessageKey(type, name);
        const handlers = this.handlers.get(key) || [];

        if (type === 'command' && handlers.length > 0) {
            throw new Error(`Handler for command "${name}" already registered`);
        }

        handlers.push(handler);

        this.handlers.set(key, handlers);
    }

    async handleMessage(message: Message) {
        const key = this.getMessageKey(message.type, message.name);
        const handlers = this.handlers.get(key) || [];

        await Promise.all(handlers.map(async (handler) => handler(message)));
    }

    private getMessageKey(type: 'event' | 'command', name: string) {
        return `${type}:${name}`;
    }
}

const IncomingMessagePayloadSchema = z.object({
    message: z.object({
        data: z.string(),
    }),
});

export function createIncomingMessageHandler(bus: GCloudPubSubPushMessageBus) {
    return async function handleIncomingMessage(ctx: Context) {
        let payload: z.infer<typeof IncomingMessagePayloadSchema>;
        let message: Message;

        try {
            payload = IncomingMessagePayloadSchema.parse(await ctx.req.json());

            message = MessageSchema.parse(
                JSON.parse(
                    Buffer.from(payload.message.data, 'base64').toString(),
                ),
            );
        } catch (error) {
            return new Response(null, { status: 400 });
        }

        return bus
            .handleMessage(message)
            .then(() => new Response(null, { status: 200 }))
            .catch(() => new Response(null, { status: 500 }));
    };
}

export type CreateMessageBusConfig = {
    pubSubHost?: string;
    hostIsEmulator?: boolean;
    projectId?: string;
    topic: string;
    subscription?: string;
};

export async function createMessageBus({
    pubSubHost,
    hostIsEmulator,
    projectId,
    topic,
    subscription,
}: CreateMessageBusConfig) {
    const pubsubClientConfig: Partial<ClientConfig> = {};

    if (pubSubHost !== undefined) {
        pubsubClientConfig.apiEndpoint = pubSubHost;
    }

    if (hostIsEmulator !== undefined) {
        pubsubClientConfig.emulatorMode = hostIsEmulator;
    }

    if (projectId !== undefined) {
        pubsubClientConfig.projectId = projectId;
    }

    const pubSubClient = new PubSub(pubsubClientConfig);

    const fullTopic = `projects/${projectId}/topics/${topic}`;
    const [topics] = await pubSubClient.getTopics();

    if (!topics.some(({ name }) => name === fullTopic)) {
        throw new Error(`Topic [${topic}] does not exist`);
    }

    if (subscription !== undefined) {
        const fullSubscription = `projects/${projectId}/subscriptions/${subscription}`;
        const [subscriptions] = await pubSubClient.getSubscriptions();

        if (!subscriptions.some(({ name }) => name === fullSubscription)) {
            throw new Error(`Subscription [${subscription}] does not exist`);
        }
    }

    return new GCloudPubSubPushMessageBus(pubSubClient, fullTopic);
}
