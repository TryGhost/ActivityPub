import { beforeEach, describe, expect, it } from 'vitest';

import { EventSerializer } from './event';

class TestEvent {
    constructor(
        private readonly id: number,
        private readonly timestamp: string,
    ) {}

    toJSON() {
        return {
            id: this.id,
            timestamp: this.timestamp,
        };
    }

    static fromJSON(data: object): TestEvent {
        if (!('id' in data) || !(typeof data.id === 'number')) {
            throw new Error('id must be a number');
        }

        if (!('timestamp' in data) || !(typeof data.timestamp === 'string')) {
            throw new Error('timestamp must be a string');
        }

        return new TestEvent(data.id, data.timestamp);
    }
}

describe('EventSerializer', () => {
    let serializer: EventSerializer;

    beforeEach(() => {
        serializer = new EventSerializer();
    });

    it('should serialize an event', () => {
        serializer.register('foo', TestEvent);

        const event = new TestEvent(123, '2025-05-06T09:30:00.000Z');

        const serialized = serializer.serialize(event);

        expect(serialized).toEqual({
            id: 123,
            timestamp: '2025-05-06T09:30:00.000Z',
        });
    });

    it('should deserialize an event', () => {
        serializer.register('foo', TestEvent);

        const event = new TestEvent(123, '2025-05-06T09:30:00.000Z');

        const serialized = serializer.serialize(event);

        const deserialized = serializer.deserialize('foo', serialized);

        expect(deserialized).toEqual(event);
    });

    it('should throw an error when deserializing an event that has not been registered', () => {
        expect(() => serializer.deserialize('foo', { id: 123 })).toThrow(
            'Unknown event [foo]',
        );
    });
});
