export interface SerializableEvent {
    toJSON(): object;
}

export interface DeserializableEvent {
    fromJSON(data: object): SerializableEvent;
}

export class EventSerializer {
    private eventTypes: Record<string, DeserializableEvent> = {};

    register(name: string, type: DeserializableEvent): void {
        this.eventTypes[name] = type;
    }

    serialize(event: SerializableEvent): object {
        return event.toJSON();
    }

    deserialize(name: string, data: object): SerializableEvent {
        const eventType = this.eventTypes[name];

        if (!eventType) {
            throw new Error(`Unknown event: ${name}`);
        }

        return eventType.fromJSON(data);
    }
}
