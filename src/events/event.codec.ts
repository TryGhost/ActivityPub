import { PostCreatedEvent } from 'post/post-created.event';
import type { KnexPostRepository } from 'post/post.repository.knex';

export class EventCodec {
    constructor(private readonly postRepository: KnexPostRepository) {}

    async encode(eventName: string, event: object): Promise<Buffer> {
        if (eventName === PostCreatedEvent.getName()) {
            if (!(event instanceof PostCreatedEvent)) {
                throw new Error('Expected a PostCreatedEvent');
            }
            const data = {
                id: event.getPost().id,
            };

            return Buffer.from(JSON.stringify(data));
        }
        throw new Error(`Unknown event ${eventName}`);
    }

    async decode(eventName: string, buffer: Buffer): Promise<object> {
        let data = null;
        try {
            data = JSON.parse(buffer.toString('utf-8'));
        } catch (err) {
            throw new Error(`Could not decode event ${eventName}`);
        }
        if (eventName === PostCreatedEvent.getName()) {
            const post = await this.postRepository.getByApId(data.id);
            if (!post) {
                throw new Error(`Could not decode event ${eventName} ${data}`);
            }
            const event = new PostCreatedEvent(post);
            return event;
        }

        throw new Error(`Unknown event ${eventName}`);
    }
}
