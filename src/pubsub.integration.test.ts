import { PubSub } from '@google-cloud/pubsub';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { getFullTopic, initPubSubClient } from '@/pubsub';

vi.mock('@google-cloud/pubsub', () => ({
    PubSub: vi.fn(),
}));

const PROJECT_ID = 'test-project';
const HOST = 'test-host';

describe('initPubSubClient', () => {
    let mockPubSubClient: Partial<PubSub>;

    beforeEach(() => {
        mockPubSubClient = {
            projectId: PROJECT_ID,
        };

        (PubSub as unknown as Mock).mockImplementation(() => mockPubSubClient);
    });

    it('should return a configured Pub/Sub client', async () => {
        const pubSubClient = await initPubSubClient({
            projectId: PROJECT_ID,
            host: HOST,
            isEmulator: true,
        });

        expect(PubSub).toHaveBeenCalledWith({
            apiEndpoint: HOST,
            emulatorMode: true,
            projectId: PROJECT_ID,
        });

        expect(pubSubClient).toBe(mockPubSubClient);
    });
});

describe('getFullTopic', () => {
    it('should return the full topic name', () => {
        const fullTopic = getFullTopic('foo', 'bar');

        expect(fullTopic).toBe('projects/foo/topics/bar');
    });
});
