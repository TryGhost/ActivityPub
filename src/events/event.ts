export interface SerializableEvent {
    toJSON(): Record<string, unknown>;
}

export interface DeserializableEventConstructor {
    fromJSON(data: Record<string, unknown>): SerializableEvent;
}

export class EventSerializer {
    private eventTypes: Record<string, DeserializableEventConstructor> = {};

    register(name: string, type: DeserializableEventConstructor): void {
        this.eventTypes[name] = type;
    }

    serialize(event: SerializableEvent): Record<string, unknown> {
        return event.toJSON();
    }

    deserialize(
        name: string,
        data: Record<string, unknown>,
    ): SerializableEvent {
        const eventType = this.eventTypes[name];

        if (!eventType) {
            throw new Error(`Unknown event [${name}]`);
        }

        return eventType.fromJSON(data);
    }
}
