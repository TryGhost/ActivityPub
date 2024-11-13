import type { Context } from 'hono';

import type { HonoContextVariables } from '../../../app';
import { EVENT_MQ_MESSAGE_RECEIVED } from '../../../constants';
import { MqMessageReceivedEvent } from '../../../events/mq-message-received-event';

export async function handleMessageAction(
    ctx: Context<{ Variables: HonoContextVariables }>,
): Promise<Response> {
    const logger = ctx.get('logger');
    const eventBus = ctx.get('eventBus');

    const json = await ctx.req.json();
    const pubSubId = json?.message?.message_id ?? 'unknown';

    // If no listeners are attached, we should not process the message
    if (eventBus.listenerCount(EVENT_MQ_MESSAGE_RECEIVED) === 0) {
        logger.info(
            `No event listeners attached to [${EVENT_MQ_MESSAGE_RECEIVED}], nacking incoming message [PubSub ID: ${pubSubId}]`,
        );

        return new Response(null, { status: 429 });
    }

    // Return a promise that will eventually resolve when a message is ack'd or nack'd
    return await new Promise<Response>((resolve) => {
        let data = {};

        try {
            data = JSON.parse(
                Buffer.from(json.message.data, 'base64').toString(),
            );
        } catch (error) {
            logger.error(
                `Failed to parse message data [PubSub ID: ${pubSubId}]: ${error}`,
            );

            return resolve(new Response(null, { status: 500 }));
        }

        const event = new MqMessageReceivedEvent({
            id: json.message.message_id,
            subscriptionIdentifier: json.subscription,
            data,
            attributes: json.message.attributes,
            onAck: () => resolve(new Response(null, { status: 200 })),
            onNack: () => resolve(new Response(null, { status: 500 })),
        });

        eventBus.emit(EVENT_MQ_MESSAGE_RECEIVED, event);

        // TODO: Handle timeout
    });
}
