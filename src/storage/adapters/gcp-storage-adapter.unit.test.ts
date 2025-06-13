import { type Bucket, Storage } from '@google-cloud/storage';
import type { Logger } from '@logtape/logtape';
import { getValue, isError } from 'core/result';
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { GCPStorageAdapter } from './gcp-storage-adapter';

const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
} as unknown as Logger;

vi.mock('@google-cloud/storage', () => ({
    Storage: vi.fn(),
}));

describe('GCPStorageAdapter', () => {
    let mockBucket: Bucket;
    let mockStorage: Storage;
    let adapter: GCPStorageAdapter;

    beforeEach(() => {
        process.env.GCP_BUCKET_NAME = 'test-bucket';
        process.env.GCP_STORAGE_EMULATOR_HOST = 'http://fake-gcs:4443';

        mockBucket = {
            exists: vi.fn().mockResolvedValue([true]),
            file: vi.fn().mockReturnValue({
                save: vi.fn().mockResolvedValue(undefined),
                publicUrl: vi
                    .fn()
                    .mockReturnValue(
                        'https://storage.googleapis.com/test-bucket/images/test-uuid/test.png',
                    ),
            }),
            name: 'test-bucket',
            create: vi.fn().mockResolvedValue(undefined),
        } as unknown as Bucket;

        mockStorage = {
            bucket: vi.fn().mockReturnValue(mockBucket),
        } as unknown as Storage;

        (Storage as unknown as Mock).mockImplementation(() => mockStorage);

        adapter = new GCPStorageAdapter('test-bucket', mockLogger);
    });

    describe('.save()', () => {
        it('saves a file and returns a URL', async () => {
            const file = new File([], 'test.png', { type: 'image/png' });
            const result = await adapter.save(
                file,
                'images/test-uuid/test.png',
            );

            expect(isError(result)).toBe(false);

            if (!isError(result)) {
                expect(getValue(result)).toBe(
                    'https://storage.googleapis.com/test-bucket/images/test-uuid/test.png',
                );
            }
        });
    });
});
