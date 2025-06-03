import { z } from 'zod';

export interface EventMessage {
    type: 'event';
    name: string;
    data: unknown;
}

export interface CommandMessage {
    type: 'command';
    name: string;
    data: unknown;
}

export type Message = EventMessage | CommandMessage;

export const MessageSchema = z.object({
    type: z.enum(['event', 'command']),
    name: z.string(),
    data: z.record(z.unknown()),
});

export interface MessageBus {
    publishMessage(message: Message): Promise<string>;
    registerMessageHandler(
        type: 'event' | 'command',
        name: string,
        handler: (message: Message) => void,
    ): void;
    handleMessage(message: Message): Promise<void>;
}
