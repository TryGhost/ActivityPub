import type { Context } from 'hono';
import { z } from 'zod';

import { PUBSUB_MESSAGE_ATTR_EVENT_NAME, type PubSubEvents } from './pubsub';

const IncomingMessagePayloadSchema = z.object({
    message: z.object({
        data: z.string(),
        attributes: z.record(z.string(), z.string()),
    }),
});

export function createIncomingPubSubMessageHandler(events: PubSubEvents) {
    return async function handleIncomingPubSubMessage(ctx: Context) {
        let payload: z.infer<typeof IncomingMessagePayloadSchema>;

        try {
            payload = IncomingMessagePayloadSchema.parse(await ctx.req.json());

            if (!payload.message.attributes[PUBSUB_MESSAGE_ATTR_EVENT_NAME]) {
                throw new Error(
                    `[${PUBSUB_MESSAGE_ATTR_EVENT_NAME}] missing from payload`,
                );
            }
        } catch (error) {
            return new Response(null, { status: 400 });
        }

        return events
            .handleIncomingMessage(
                payload.message.data,
                payload.message.attributes,
            )
            .then(() => new Response(null, { status: 200 }))
            .catch(() => new Response(null, { status: 500 }));
    };
}
