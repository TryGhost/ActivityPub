import type { Mention } from 'mention/mention.entity';

export class MentionCreatedEvent {
    constructor(private readonly mention: Mention) {}

    getMention(): Mention {
        return this.mention;
    }

    static getName(): string {
        return 'mention.created';
    }
}
