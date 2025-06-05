export interface SerializableEvent {
    toJSON(): object;
}

export interface DeserializableEventConstructor {
    fromJSON(data: object): SerializableEvent;
}

export class EventSerializer {
    private eventTypes: Record<string, DeserializableEventConstructor> = {};

    register(name: string, type: DeserializableEventConstructor): void {
        this.eventTypes[name] = type;
    }

    serialize(event: SerializableEvent): object {
        return event.toJSON();
    }

    deserialize(name: string, data: object): SerializableEvent {
        const eventType = this.eventTypes[name];

        if (!eventType) {
            throw new Error(`Unknown event [${name}]`);
        }

        return eventType.fromJSON(data);
    }
}
