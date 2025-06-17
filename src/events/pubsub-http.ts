import type { Federation } from '@fedify/fedify';
import * as Sentry from '@sentry/node';
import type { Context } from 'hono';
import { z } from 'zod';

import type { FedifyContextFactory } from 'activitypub/fedify-context.factory';
import type { ContextData } from 'app';
import { createFedifyCtxForHost } from 'helpers/fedify';

import {
    PUBSUB_MESSAGE_ATTR_EVENT_HOST,
    PUBSUB_MESSAGE_ATTR_EVENT_NAME,
    type PubSubEvents,
} from './pubsub';

const IncomingMessagePayloadSchema = z.object({
    message: z.object({
        data: z.string(),
        attributes: z.record(z.string(), z.string()),
    }),
});

export function createIncomingPubSubMessageHandler(
    events: PubSubEvents,
    fedify: Federation<ContextData>,
    fedifyContextFactory: FedifyContextFactory,
) {
    return async function handleIncomingPubSubMessage(
        ctx: Context,
    ): Promise<Response> {
        // Validate the incoming message
        let payload: z.infer<typeof IncomingMessagePayloadSchema>;

        try {
            payload = IncomingMessagePayloadSchema.parse(await ctx.req.json());

            if (!payload.message.attributes[PUBSUB_MESSAGE_ATTR_EVENT_NAME]) {
                throw new Error(
                    `[${PUBSUB_MESSAGE_ATTR_EVENT_NAME}] missing from payload`,
                );
            }

            if (!payload.message.attributes[PUBSUB_MESSAGE_ATTR_EVENT_HOST]) {
                throw new Error(
                    `[${PUBSUB_MESSAGE_ATTR_EVENT_HOST}] missing from payload`,
                );
            }
        } catch (error) {
            return new Response(null, { status: 400 });
        }

        try {
            // Construct a new Fedify context that is specific to the event host.
            // We do this as we cannot infer the host from the request context
            // for pubsub push message requests due to the request coming from
            // the pubsub service.
            const hostFedifyCtx = createFedifyCtxForHost(
                fedify,
                payload.message.attributes[PUBSUB_MESSAGE_ATTR_EVENT_HOST],
                {
                    globaldb: ctx.get('globaldb'),
                    logger: ctx.get('logger'),
                },
            );

            // Register the newly constructed Fedify context and execute the
            // event handlers within this context
            await fedifyContextFactory.registerContext(
                hostFedifyCtx,
                async () => {
                    await events.handleIncomingMessage(
                        payload.message.data,
                        payload.message.attributes,
                    );
                },
            );

            return new Response(null, { status: 200 });
        } catch (error) {
            Sentry.captureException(error);

            ctx.get('logger').error(
                'Failed to handle incoming Pub/Sub message: {error}',
                {
                    error,
                    message: payload.message,
                },
            );

            return new Response(null, { status: 500 });
        }
    };
}
