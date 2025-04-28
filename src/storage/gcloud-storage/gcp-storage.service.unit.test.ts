import { type Bucket, Storage } from '@google-cloud/storage';
import type { Logger } from '@logtape/logtape';
import { error, ok } from 'core/result';
import sharp from 'sharp';
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { GCPStorageService } from './gcp-storage.service';

vi.mock('@google-cloud/storage', () => ({
    Storage: vi.fn(),
}));

describe('GCPStorageService', () => {
    let service: GCPStorageService;
    let mockBucket: Bucket;
    let mockStorage: Storage;
    let mockLogger: Logger;

    async function createMockFile(
        type: 'image/jpeg' | 'image/png' | 'image/webp',
        fileName: string,
        width = 100,
        height = 100,
    ): Promise<File> {
        // Create an in-memory image, with the given height/width
        const imageType = type.split('/')[1] as 'jpeg' | 'png' | 'webp';
        const buffer = await sharp({
            create: {
                width,
                height,
                channels: 3,
                background: { r: 255, g: 0, b: 0 },
            },
        })
            .toFormat(imageType)
            .toBuffer();

        return new File([buffer], fileName, { type });
    }

    beforeEach(() => {
        process.env.GCP_BUCKET_NAME = 'test-bucket';
        process.env.GCP_STORAGE_EMULATOR_HOST = 'http://fake-gcs:4443';

        mockLogger = {
            info: vi.fn(),
            error: vi.fn(),
            warn: vi.fn(),
        } as unknown as Logger;

        mockBucket = {
            exists: vi.fn().mockResolvedValue([true]),
            file: vi.fn().mockReturnValue({
                save: vi.fn().mockResolvedValue(undefined),
                exists: vi.fn().mockResolvedValue([true]),
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
    });

    describe('constructor', () => {
        it('throws error if bucket name is not configured', () => {
            process.env.GCP_BUCKET_NAME = '';
            expect(() => new GCPStorageService(mockLogger)).toThrow(
                'GCP bucket name is not configured',
            );
        });

        it('initializes storage and bucket', () => {
            service = new GCPStorageService(mockLogger);
            expect(Storage).toHaveBeenCalled();
            expect(mockStorage.bucket).toHaveBeenCalledWith('test-bucket');
        });
    });

    describe('init', () => {
        beforeEach(() => {
            service = new GCPStorageService(mockLogger);
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
            service = new GCPStorageService(mockLogger);
        });

        it('validates file size', async () => {
            const largeFile = new File(
                ['x'.repeat(6 * 1024 * 1024)],
                'large.jpg',
                {
                    type: 'image/jpeg',
                },
            );

            const result = await service.saveFile(largeFile, 'test-uuid');

            expect(result).toEqual(error('file-too-large'));
        });

        it('validates file type', async () => {
            const unsupportedFile = new File(['test'], 'test.txt', {
                type: 'text/plain',
            });

            const result = await service.saveFile(unsupportedFile, 'test-uuid');
            expect(result).toEqual(error('file-type-not-supported'));
        });

        it('saves valid file and returns URL', async () => {
            const validFile = await createMockFile('image/png', 'my-image.png');

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
            const validFile = await createMockFile('image/png', 'my-image.png');

            await service.saveFile(validFile, 'test-uuid');

            const [storagePath] = (mockBucket.file as Mock).mock.calls[0];
            expect(storagePath).toMatch(/\.png$/);
        });

        it('generates path without extension if file has none', async () => {
            const validFile = await createMockFile('image/png', 'my-image');

            await service.saveFile(validFile, 'test-uuid');

            const [storagePath] = (mockBucket.file as Mock).mock.calls[0];
            expect(storagePath).toMatch(/^images\/test-uuid\/[a-f0-9-]+$/);
        });
    });

    describe('verifyImageUrl', () => {
        describe('in emulator mode', () => {
            beforeEach(() => {
                process.env.GCP_STORAGE_EMULATOR_HOST = 'http://fake-gcs:4443';
                service = new GCPStorageService(mockLogger);
            });

            it('handles valid emulator URL verification', async () => {
                const validUrl =
                    'http://localhost:4443/storage/v1/b/test-bucket/o/images/test-uuid/test.png?alt=media';
                const result = await service.verifyImageUrl(new URL(validUrl));
                expect(result).toEqual(ok(true));
            });

            it('handles malformed emulator URL verification', async () => {
                const invalidUrl = 'http://invalid-domain/test.png';
                const result = await service.verifyImageUrl(
                    new URL(invalidUrl),
                );
                expect(result).toEqual(error('invalid-url'));
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
                service = new GCPStorageService(mockLogger);
            });

            it('handles valid GCS URL verification when file exists', async () => {
                const validUrl =
                    'https://storage.googleapis.com/test-bucket/images/test-uuid/test.png';
                const result = await service.verifyImageUrl(new URL(validUrl));

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
                const result = await service.verifyImageUrl(new URL(validUrl));
                expect(result).toEqual(error('file-not-found'));
            });

            it('handles wrong bucket URL verification', async () => {
                const invalidUrl =
                    'https://wronghost.com/test-bucket/images/test-uuid/test.png';
                const result = await service.verifyImageUrl(
                    new URL(invalidUrl),
                );
                expect(result).toEqual(error('invalid-url'));
            });

            it('handles malformed GCS URL verification', async () => {
                const invalidUrl =
                    'https://storage.googleapis.com/test-bucket/';
                const result = await service.verifyImageUrl(
                    new URL(invalidUrl),
                );
                expect(result).toEqual(error('invalid-file-path'));
            });

            it('handles GCS error during verification', async () => {
                mockFile.exists = vi
                    .fn()
                    .mockRejectedValue(new Error('GCS error'));
                const validUrl =
                    'https://storage.googleapis.com/test-bucket/images/test-uuid/test.png';
                const result = await service.verifyImageUrl(new URL(validUrl));
                expect(result).toEqual(error('gcs-error'));
            });
        });
    });

    describe('compressFile', () => {
        beforeEach(() => {
            service = new GCPStorageService(mockLogger);
        });

        it('compresses a JPEG file and reduces its size', async () => {
            const mockFile = await createMockFile(
                'image/jpeg',
                'image.jpg',
                2000,
                2000,
            );
            const originalSize = mockFile.size;

            const compressedBuffer = await (
                service as unknown as {
                    compressFile: (file: File) => Promise<Buffer>;
                }
            ).compressFile(mockFile);

            expect(compressedBuffer).toBeInstanceOf(Buffer);
            expect(compressedBuffer.length).toBeLessThan(originalSize);

            const metadata = await sharp(compressedBuffer).metadata();
            expect(metadata.format).toBe('jpeg');
            expect(metadata.width).toBeLessThanOrEqual(1200);
        });

        it('compresses a PNG file and reduces its size', async () => {
            const mockFile = await createMockFile(
                'image/png',
                'image.jpg',
                2000,
                2000,
            );
            const originalSize = mockFile.size;

            const compressedBuffer = await (
                service as unknown as {
                    compressFile: (file: File) => Promise<Buffer>;
                }
            ).compressFile(mockFile);

            expect(compressedBuffer).toBeInstanceOf(Buffer);
            expect(compressedBuffer.length).toBeLessThan(originalSize);

            const metadata = await sharp(compressedBuffer).metadata();
            expect(metadata.format).toBe('png');
            expect(metadata.width).toBeLessThanOrEqual(1200);
        });

        it('compresses a WebP file and reduces its size', async () => {
            const mockFile = await createMockFile(
                'image/webp',
                'image.jpg',
                2000,
                2000,
            );
            const originalSize = mockFile.size;

            const compressedBuffer = await (
                service as unknown as {
                    compressFile: (file: File) => Promise<Buffer>;
                }
            ).compressFile(mockFile);

            expect(compressedBuffer).toBeInstanceOf(Buffer);
            expect(compressedBuffer.length).toBeLessThan(originalSize);

            const metadata = await sharp(compressedBuffer).metadata();
            expect(metadata.format).toBe('webp');
            expect(metadata.width).toBeLessThanOrEqual(1200);
        });

        it('returns original buffer for unsupported types', async () => {
            const textContent = 'hello world';
            const unsupportedFile = new File([textContent], 'test.txt', {
                type: 'text/plain',
            });
            const originalSize = unsupportedFile.size;

            const compressedBuffer = await (
                service as unknown as {
                    compressFile: (file: File) => Promise<Buffer>;
                }
            ).compressFile(unsupportedFile);

            expect(compressedBuffer).toBeInstanceOf(Buffer);
            expect(compressedBuffer.length).toEqual(originalSize);
            expect(compressedBuffer.toString()).toBe(textContent);
        });

        it('does not enlarge small images beyond their original size', async () => {
            const smallFile = await createMockFile(
                'image/jpeg',
                'small-file.jpg',
                600,
                400,
            );

            const compressedBuffer = await (
                service as unknown as {
                    compressFile: (file: File) => Promise<Buffer>;
                }
            ).compressFile(smallFile);

            expect(compressedBuffer).toBeInstanceOf(Buffer);

            const metadata = await sharp(compressedBuffer).metadata();

            expect(metadata.width).toEqual(600);
            expect(metadata.height).toEqual(400);
            expect(metadata.format).toBe('jpeg');
        });
    });
});
