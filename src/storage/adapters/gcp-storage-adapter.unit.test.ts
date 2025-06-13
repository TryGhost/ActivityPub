import { type Bucket, Storage } from '@google-cloud/storage';
import type { Logger } from '@logtape/logtape';
import { error, getValue, isError, ok } from 'core/result';
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

    describe('.verifyFileUrl()', () => {
        describe('in emulator mode', () => {
            beforeEach(() => {
                const emulatorHost = 'http://fake-gcs:4443';
                adapter = new GCPStorageAdapter(
                    'test-bucket',
                    mockLogger,
                    emulatorHost,
                );
            });

            it('handles valid emulator URL verification', async () => {
                const validUrl =
                    'http://localhost:4443/storage/v1/b/test-bucket/o/images/test-uuid/test.png?alt=media';
                const result = await adapter.verifyFileUrl(new URL(validUrl));
                expect(result).toEqual(ok(true));
            });

            it('handles malformed emulator URL verification', async () => {
                const invalidUrl = 'http://invalid-domain/test.png';
                const result = await adapter.verifyFileUrl(new URL(invalidUrl));
                expect(result).toEqual(error('invalid-url'));
            });
        });

        describe('in production mode', () => {
            let mockFile: { exists: Mock };

            beforeEach(() => {
                mockFile = {
                    exists: vi.fn().mockResolvedValue([true]),
                };

                (mockBucket.file as Mock).mockReturnValue(mockFile);
            });

            it('handles valid GCS URL verification when file exists', async () => {
                const validUrl =
                    'https://storage.googleapis.com/test-bucket/images/test-uuid/test.png';
                const result = await adapter.verifyFileUrl(new URL(validUrl));

                expect(mockBucket.file).toHaveBeenCalledWith(
                    'images/test-uuid/test.png',
                );
                expect(mockFile.exists).toHaveBeenCalled();
                expect(result).toEqual(ok(true));
            });

            it('handles non-existent file verification', async () => {
                mockFile.exists = vi.fn().mockResolvedValue([false]);
                const validUrl =
                    'https://storage.googleapis.com/test-bucket/images/test-uuid/test.png';
                const result = await adapter.verifyFileUrl(new URL(validUrl));
                expect(result).toEqual(error('file-not-found'));
            });

            it('handles wrong bucket URL verification', async () => {
                const invalidUrl =
                    'https://wronghost.com/test-bucket/images/test-uuid/test.png';
                const result = await adapter.verifyFileUrl(new URL(invalidUrl));
                expect(result).toEqual(error('invalid-url'));
            });

            it('handles malformed GCS URL verification', async () => {
                const invalidUrl =
                    'https://storage.googleapis.com/test-bucket/';
                const result = await adapter.verifyFileUrl(new URL(invalidUrl));
                expect(result).toEqual(error('invalid-file-path'));
            });
        });
    });
});
