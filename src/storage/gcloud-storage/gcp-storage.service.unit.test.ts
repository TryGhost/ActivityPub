import { type Bucket, Storage } from '@google-cloud/storage';
import { error, ok } from 'core/result';
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { GCPStorageService } from './gcp-storage.service';

vi.mock('@google-cloud/storage', () => ({
    Storage: vi.fn(),
}));

describe('GCPStorageService', () => {
    let service: GCPStorageService;
    let mockBucket: Bucket;
    let mockStorage: Storage;

    beforeEach(() => {
        process.env.GCP_BUCKET_NAME = 'test-bucket';
        process.env.GCP_STORAGE_EMULATOR_HOST = 'http://fake-gcs:4443';

        mockBucket = {
            exists: vi.fn().mockResolvedValue([true]),
            file: vi.fn().mockReturnValue({
                save: vi.fn().mockResolvedValue(undefined),
            }),
            name: 'test-bucket',
            create: vi.fn().mockResolvedValue(undefined),
        } as unknown as Bucket;

        mockStorage = {
            bucket: vi.fn().mockReturnValue(mockBucket),
        } as unknown as Storage;

        (Storage as unknown as Mock).mockImplementation(() => mockStorage);
    });

    describe('constructor', () => {
        it('throws error if bucket name is not configured', () => {
            process.env.GCP_BUCKET_NAME = '';
            expect(() => new GCPStorageService()).toThrow(
                'GCP bucket name is not configured',
            );
        });

        it('initializes storage and bucket', () => {
            service = new GCPStorageService();
            expect(Storage).toHaveBeenCalled();
            expect(mockStorage.bucket).toHaveBeenCalledWith('test-bucket');
        });
    });

    describe('init', () => {
        beforeEach(() => {
            service = new GCPStorageService();
        });

        it('verifies bucket exists', async () => {
            await service.init();
            expect(mockBucket.exists).toHaveBeenCalled();
        });

        it('throws error if bucket does not exist', async () => {
            (mockBucket.exists as Mock).mockResolvedValue([false]);
            await expect(service.init()).rejects.toThrow(
                'Bucket [test-bucket] does not exist',
            );
        });
    });

    describe('saveFile', () => {
        beforeEach(() => {
            service = new GCPStorageService();
        });

        it('validates file size', async () => {
            const largeFile = new globalThis.File(
                ['x'.repeat(26 * 1024 * 1024)],
                'large.jpg',
                { type: 'image/jpeg' },
            );
            const result = await service.saveFile(largeFile, 'test-uuid');
            expect(result).toEqual(error('file-too-large'));
        });

        it('validates file type', async () => {
            const invalidFile = new globalThis.File(['test'], 'test.txt', {
                type: 'text/plain',
            });
            const result = await service.saveFile(invalidFile, 'test-uuid');
            expect(result).toEqual(error('file-type-not-supported'));
        });

        it('saves valid file and returns URL', async () => {
            const validFile = new globalThis.File(['test'], 'test.png', {
                type: 'image/png',
            });
            const result = await service.saveFile(validFile, 'test-uuid');
            expect(result).toEqual(
                ok(
                    expect.stringMatching(
                        /^http:\/\/localhost:4443\/storage\/v1\/b\/test-bucket\/o\/images%2Ftest-uuid%2F[a-f0-9-]+\.png\?alt=media$/,
                    ),
                ),
            );
            expect(mockBucket.file).toHaveBeenCalled();
        });

        it('preserves file extension in storage path', async () => {
            const validFile = new globalThis.File(['test'], 'test.png', {
                type: 'image/png',
            });
            await service.saveFile(validFile, 'test-uuid');
            const [storagePath] = (mockBucket.file as Mock).mock.calls[0];
            expect(storagePath).toMatch(/\.png$/);
        });

        it('generates path without extension if file has none', async () => {
            const validFile = new globalThis.File(['test'], 'test', {
                type: 'image/png',
            });
            await service.saveFile(validFile, 'test-uuid');
            const [storagePath] = (mockBucket.file as Mock).mock.calls[0];
            expect(storagePath).toMatch(/^images\/test-uuid\/[a-f0-9-]+$/);
        });
    });

    describe('verifyImageUrl', () => {
        describe('in emulator mode', () => {
            beforeEach(() => {
                process.env.GCP_STORAGE_EMULATOR_HOST = 'http://fake-gcs:4443';
                service = new GCPStorageService();
            });

            it('returns true for valid emulator URL', async () => {
                const validUrl =
                    'http://localhost:4443/storage/v1/b/test-bucket/o/images/test-uuid/test.png?alt=media';
                const result = await service.verifyImageUrl(validUrl);
                expect(result).toBe(true);
            });

            it('returns false for malformed emulator URL', async () => {
                const invalidUrl = 'http://invalid-domain/test.png';
                const result = await service.verifyImageUrl(invalidUrl);
                expect(result).toBe(false);
            });
        });

        describe('in production mode', () => {
            let mockFile: { exists: Mock };

            beforeEach(() => {
                // Ensure emulator host is undefined for production mode
                process.env.GCP_STORAGE_EMULATOR_HOST = '';
                process.env.GCP_BUCKET_NAME = 'test-bucket';

                // Setup mock file with exists method
                mockFile = {
                    exists: vi.fn().mockResolvedValue([true]),
                };

                (mockBucket.file as Mock).mockReturnValue(mockFile);
                service = new GCPStorageService();
            });

            it('returns true for valid GCS URL when file exists', async () => {
                const validUrl =
                    'https://storage.googleapis.com/test-bucket/images/test-uuid/test.png';
                const result = await service.verifyImageUrl(validUrl);

                expect(mockBucket.file).toHaveBeenCalledWith(
                    'images/test-uuid/test.png',
                );
                expect(mockFile.exists).toHaveBeenCalled();
                expect(result).toBe(true);
            });

            it('returns false for valid GCS URL when file does not exist', async () => {
                mockFile.exists = vi.fn().mockResolvedValue([false]);
                const validUrl =
                    'https://storage.googleapis.com/test-bucket/images/test-uuid/test.png';
                const result = await service.verifyImageUrl(validUrl);
                expect(result).toBe(false);
            });

            it('returns false for GCS URL with wrong bucket', async () => {
                const invalidUrl =
                    'https://storage.googleapis.com/wrong-bucket/images/test-uuid/test.png';
                const result = await service.verifyImageUrl(invalidUrl);
                expect(result).toBe(false);
            });

            it('returns false for malformed GCS URL', async () => {
                const invalidUrl =
                    'https://storage.googleapis.com/invalid-path';
                const result = await service.verifyImageUrl(invalidUrl);
                expect(result).toBe(false);
            });

            it('returns false when GCS check throws an error', async () => {
                mockFile.exists = vi
                    .fn()
                    .mockRejectedValue(new Error('GCS error'));
                const validUrl =
                    'https://storage.googleapis.com/test-bucket/images/test-uuid/test.png';
                const result = await service.verifyImageUrl(validUrl);
                expect(result).toBe(false);
            });
        });
    });
});
