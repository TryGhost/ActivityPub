import { beforeAll, describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { File as NodeFile } from 'fetch-blob/file.js';

import { getError, getValue, isError } from '@/core/result';
import { GCPStorageAdapter } from '@/storage/adapters/gcp-storage-adapter';
import { ImageProcessor } from '@/storage/image-processor';
import { ImageStorageService } from '@/storage/image-storage.service';

const logger = {
    info: console.log,
    error: console.error,
    warn: console.warn,
} as unknown as import('@logtape/logtape').Logger;

const TEST_IMAGE_PATH = path.join(__dirname, './__fixtures__/dog.jpg');
const TEST_ACCOUNT_UUID = 'integration-tests';

describe('Image Storage Service - GCP Storage Integration', () => {
    let adapter: GCPStorageAdapter;
    let service: ImageStorageService;
    let imageProcessor: ImageProcessor;

    beforeAll(async () => {
        adapter = new GCPStorageAdapter(
            process.env.GCP_BUCKET_NAME || '',
            logger,
            process.env.GCP_STORAGE_EMULATOR_HOST || '',
            process.env.GCS_LOCAL_STORAGE_HOSTING_URL || '',
        );
        imageProcessor = new ImageProcessor(logger);
        service = new ImageStorageService(adapter, imageProcessor);
    });

    describe('.save()', () => {
        it('should save an image file to the bucket and return a valid URL', async () => {
            const buffer = readFileSync(TEST_IMAGE_PATH);
            const file = new NodeFile([buffer], 'dog.jpg', {
                type: 'image/jpeg',
            });

            const result = await service.save(
                file as unknown as File,
                `images/${TEST_ACCOUNT_UUID}/`,
            );

            expect(isError(result)).toBe(false);
            if (!isError(result)) {
                const url = getValue(result);
                expect(url).toBeTruthy();
                expect(() => new URL(url)).not.toThrow();
                expect(url).toContain(TEST_ACCOUNT_UUID);

                if (process.env.GCP_STORAGE_EMULATOR_HOST) {
                    expect(url).toContain('/.ghost/activitypub/gcs/images/');
                } else {
                    const res = await fetch(url);
                    expect(res.status).toBe(200);
                }
            }
        });

        it('should reject files larger than 5MB', async () => {
            // Create a 6MB buffer
            const largeBuffer = Buffer.alloc(6 * 1024 * 1024);
            const file = new NodeFile([largeBuffer], 'large.jpg', {
                type: 'image/jpeg',
            });

            const result = await service.save(
                file as unknown as File,
                `images/${TEST_ACCOUNT_UUID}/`,
            );

            expect(isError(result)).toBe(true);
            if (isError(result)) {
                expect(getError(result)).toBe('file-too-large');
            }
        });

        it('should reject unsupported file types', async () => {
            const buffer = readFileSync(TEST_IMAGE_PATH);
            const file = new NodeFile([buffer], 'test.bmp', {
                type: 'image/bmp',
            });

            const result = await service.save(
                file as unknown as File,
                `images/${TEST_ACCOUNT_UUID}/`,
            );

            expect(isError(result)).toBe(true);
            if (isError(result)) {
                expect(getError(result)).toBe('file-type-not-supported');
            }
        });
    });

    describe('.verifyFileUrl()', () => {
        it('should verify a valid image URL', async () => {
            const buffer = readFileSync(TEST_IMAGE_PATH);
            const file = new NodeFile([buffer], 'dog.jpg', {
                type: 'image/jpeg',
            });

            const saveResult = await service.save(
                file as unknown as File,
                `images/${TEST_ACCOUNT_UUID}/`,
            );

            expect(isError(saveResult)).toBe(false);
            if (!isError(saveResult)) {
                const url = new URL(getValue(saveResult));
                const verifyResult = await service.verifyFileUrl(url);
                expect(isError(verifyResult)).toBe(false);
                if (!isError(verifyResult)) {
                    expect(getValue(verifyResult)).toBe(true);
                }
            }
        });

        it('should reject invalid URLs', async () => {
            const invalidUrl = new URL('https://example.com/invalid.jpg');
            const result = await service.verifyFileUrl(invalidUrl);

            expect(isError(result)).toBe(true);
            if (isError(result)) {
                expect(getError(result)).toBe('invalid-url');
            }
        });

        it('should reject URLs with invalid file paths', async () => {
            const invalidPathUrl = new URL(
                'https://storage.googleapis.com/activitypub/invalid/path.jpg',
            );
            const result = await service.verifyFileUrl(invalidPathUrl);

            expect(isError(result)).toBe(true);
            if (isError(result)) {
                process.env.GCP_STORAGE_EMULATOR_HOST
                    ? expect(getError(result)).toBe('invalid-url')
                    : expect(getError(result)).toBe('invalid-file-path');
            }
        });

        it('should reject non-existent files', async () => {
            const nonExistentUrl = new URL(
                `https://storage.googleapis.com/${process.env.GCP_BUCKET_NAME}/images/nonexistent.jpg`,
            );
            const result = await service.verifyFileUrl(nonExistentUrl);

            expect(isError(result)).toBe(true);
            if (isError(result)) {
                process.env.GCP_STORAGE_EMULATOR_HOST
                    ? expect(getError(result)).toBe('invalid-url')
                    : expect(getError(result)).toBe('file-not-found');
            }
        });
    });
});
