interface MqMessageReceivedEventOptions {
    id: string;
    subscriptionIdentifier: string;
    data: Record<string, unknown>;
    attributes: Record<string, string>;
    onAck: () => void;
    onNack: () => void;
}

export class MqMessageReceivedEvent {
    readonly id: string;
    readonly subscriptionIdentifier: string;
    readonly data: Record<string, unknown>;
    readonly attributes: Record<string, string>;
    private onAck: () => void;
    private onNack: () => void;

    constructor({
        id,
        subscriptionIdentifier,
        data,
        attributes,
        onAck,
        onNack,
    }: MqMessageReceivedEventOptions) {
        this.id = id;
        this.subscriptionIdentifier = subscriptionIdentifier;
        this.data = data;
        this.attributes = attributes;
        this.onAck = onAck;
        this.onNack = onNack;
    }

    ack() {
        this.onAck();
    }

    nack() {
        this.onNack();
    }
}
