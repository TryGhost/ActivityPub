import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Federation, KvStore } from '@fedify/fedify';
import type { Logger } from '@logtape/logtape';
import * as Sentry from '@sentry/node';
import type { Context } from 'hono';

import type { FedifyContextFactory } from '@/activitypub/fedify-context.factory';
import type { ContextData } from '@/app';

import type { PubSubEvents } from '@/events/pubsub';
import { createIncomingPubSubMessageHandler } from '@/events/pubsub-http';

vi.mock('@sentry/node', () => {
    return {
        captureException: vi.fn(),
    };
});

vi.mock('@/helpers/fedify', () => ({
    createFedifyCtxForHost: vi.fn(),
}));

function encode(data: object) {
    return Buffer.from(JSON.stringify(data)).toString('base64');
}

function createContext(payload: object) {
    return {
        req: {
            json: vi.fn().mockResolvedValue(payload),
        },
        get: vi.fn().mockImplementation((key) => {
            if (key === 'globaldb') {
                return {} as unknown as KvStore;
            }

            if (key === 'logger') {
                return {
                    error: vi.fn(),
                } as unknown as Logger;
            }

            return null;
        }),
    } as unknown as Context;
}

describe('handleIncomingPubSubMessage', () => {
    let pubSubEvents: PubSubEvents;
    let handler: ReturnType<typeof createIncomingPubSubMessageHandler>;

    beforeEach(async () => {
        pubSubEvents = {
            handleIncomingMessage: vi.fn().mockResolvedValue(true),
        } as unknown as PubSubEvents;
        const fedify = {} as unknown as Federation<ContextData>;
        const fedifyContextFactory = {
            registerContext: vi.fn().mockImplementation(async (ctx, fn) => {
                return await fn();
            }),
        } as unknown as FedifyContextFactory;

        handler = createIncomingPubSubMessageHandler(
            pubSubEvents,
            fedify,
            fedifyContextFactory,
        );
    });

    it('should return 200 when the message is successfully handled', async () => {
        const payload = {
            message: {
                data: encode({
                    id: 123,
                }),
                attributes: {
                    event_host: 'example.com',
                    event_name: 'foo',
                },
            },
        };

        const response = await handler(createContext(payload));

        expect(response.status).toBe(200);
    });

    it('should return 400 when the payload is invalid', async () => {
        const response = await handler({
            req: {
                json: vi.fn().mockResolvedValue(''),
            },
        } as unknown as Context);

        expect(response.status).toBe(400);
    });

    it('should return 400 when the event host is missing from the payload', async () => {
        const payload = {
            message: {
                data: encode({
                    id: 123,
                }),
                attributes: {
                    event_name: 'foo',
                },
            },
        };

        const response = await handler(createContext(payload));

        expect(response.status).toBe(400);
    });

    it('should return 400 when the event name is missing from the payload', async () => {
        const payload = {
            message: {
                data: encode({
                    id: 123,
                }),
                attributes: {},
            },
        };

        const response = await handler(createContext(payload));

        expect(response.status).toBe(400);
    });

    it('should return 500 when the message is not handled successfully', async () => {
        pubSubEvents.handleIncomingMessage = vi
            .fn()
            .mockRejectedValue(new Error('Something went wrong!'));

        const payload = {
            message: {
                data: encode({
                    id: 123,
                }),
                attributes: {
                    event_host: 'example.com',
                    event_name: 'foo',
                },
            },
        };

        const response = await handler(createContext(payload));

        expect(response.status).toBe(500);
    });

    it('should capture the error when the message is not handled successfully', async () => {
        const error = new Error('Something went wrong!');
        pubSubEvents.handleIncomingMessage = vi.fn().mockRejectedValue(error);

        const payload = {
            message: {
                data: encode({
                    id: 123,
                }),
                attributes: {
                    event_host: 'example.com',
                    event_name: 'foo',
                },
            },
        };

        const response = await handler(createContext(payload));

        expect(Sentry.captureException).toHaveBeenCalledWith(error);

        expect(response.status).toBe(500);
    });
});
