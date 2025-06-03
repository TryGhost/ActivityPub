import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PubSub } from '@google-cloud/pubsub';
import type { Context } from 'hono';

import {
    GCloudPubSubPushMessageBus,
    createIncomingMessageHandler,
} from './gcloud-pubsub-push-message-bus';

function encode(data: unknown) {
    return Buffer.from(JSON.stringify(data)).toString('base64');
}

describe('createIncomingMessageHandler', () => {
    let pubSubClient: PubSub;
    let bus: GCloudPubSubPushMessageBus;

    beforeEach(async () => {
        pubSubClient = {} as PubSub;
        bus = new GCloudPubSubPushMessageBus(
            pubSubClient,
            process.env.MQ_PUBSUB_GHOST_TOPIC_NAME!,
        );
    });

    it('should return 200 when the message is successfully handled', async () => {
        const handler = createIncomingMessageHandler(bus);

        const payload = {
            message: {
                data: encode({
                    type: 'event',
                    name: 'foo',
                    data: {
                        bar: 'baz',
                    },
                }),
            },
        };

        const response = await handler({
            req: {
                json: vi.fn().mockResolvedValue(payload),
            },
        } as unknown as Context);

        expect(response.status).toBe(200);
    });

    it('should return 400 when the payload is invalid', async () => {
        const handler = createIncomingMessageHandler(bus);

        const response = await handler({
            req: {
                json: vi.fn().mockResolvedValue(''),
            },
        } as unknown as Context);

        expect(response.status).toBe(400);
    });

    it('should return 400 when the message in payload is invalid', async () => {
        const handler = createIncomingMessageHandler(bus);

        const payload = {
            message: {
                data: encode({ foo: 'bar' }),
            },
        };

        const response = await handler({
            req: {
                json: vi.fn().mockResolvedValue(payload),
            },
        } as unknown as Context);

        expect(response.status).toBe(400);
    });

    it('should return 500 when the message is not handled successfully', async () => {
        const handler = createIncomingMessageHandler(bus);

        bus.registerMessageHandler('event', 'foo', () => {
            throw new Error('Something went wrong!');
        });

        const payload = {
            message: {
                data: encode({
                    type: 'event',
                    name: 'foo',
                    data: {
                        bar: 'baz',
                    },
                }),
            },
        };

        const response = await handler({
            req: {
                json: vi.fn().mockResolvedValue(payload),
            },
        } as unknown as Context);

        expect(response.status).toBe(500);
    });
});
