import type { Logger } from '@logtape/logtape';
import { getError, isError } from 'core/result';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { ImageProcessor } from './image-processor';

const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
} as unknown as Logger;

async function createMockFile(
    type:
        | 'image/jpeg'
        | 'image/png'
        | 'image/webp'
        | 'image/heic'
        | 'image/heif'
        | 'image/gif',
    fileName: string,
    height = 100,
    width = 100,
): Promise<File> {
    const imageType = type.split('/')[1] as
        | 'jpeg'
        | 'png'
        | 'webp'
        | 'heic'
        | 'heif';

    // For HEIC/HEIF, we'll create a JPEG buffer since Sharp might not support HEIC in tests
    const formatForSharp =
        imageType === 'heic' || imageType === 'heif' ? 'jpeg' : imageType;

    const buffer = await sharp({
        create: {
            width,
            height,
            channels: 3,
            background: { r: 255, g: 0, b: 0 },
        },
    })
        .toFormat(formatForSharp as 'jpeg' | 'png' | 'webp')
        .toBuffer();

    return new File([buffer], fileName, { type });
}

describe('ImageProcessor', () => {
    describe('.validate()', () => {
        it('passes for a valid image', async () => {
            const processor = new ImageProcessor(mockLogger);
            const file = await createMockFile('image/jpeg', 'image.jpg');
            const result = processor.validate(file);

            expect(isError(result)).toBe(false);
        });

        it('returns an error if the file is too large', () => {
            const processor = new ImageProcessor(mockLogger);
            const file = new File(['a'.repeat(6 * 1024 * 1024)], 'image.jpg', {
                type: 'image/jpeg',
            });

            const result = processor.validate(file);

            expect(isError(result)).toBe(true);

            if (isError(result)) {
                expect(getError(result)).toBe('file-too-large');
            }
        });

        it('returns an error if the image format is not supported', async () => {
            const processor = new ImageProcessor(mockLogger);
            const file = await createMockFile('image/gif', 'my-gif.gif');

            const result = processor.validate(file);

            expect(isError(result)).toBe(true);
        });
    });

    describe('.compress()', () => {
        it('compresses a JPEG file and reduces its size to fit 2000x2000', async () => {
            const file = await createMockFile(
                'image/jpeg',
                'image.jpg',
                3000,
                3000,
            );
            const originalSize = file.size;

            const processor = new ImageProcessor(mockLogger);
            const compressedBuffer = await processor.compress(file);

            expect(compressedBuffer.length).toBeLessThan(originalSize);

            const metadata = await sharp(compressedBuffer).metadata();
            expect(metadata.format).toBe('jpeg');
            expect(metadata.width).toBeLessThanOrEqual(2000);
            expect(metadata.height).toBeLessThanOrEqual(2000);
        });

        it('compresses a PNG file and reduces its size to fit 2000x2000', async () => {
            const file = await createMockFile(
                'image/png',
                'image.jpg',
                3000,
                3000,
            );
            const originalSize = file.size;

            const processor = new ImageProcessor(mockLogger);
            const compressedBuffer = await processor.compress(file);

            expect(compressedBuffer.length).toBeLessThan(originalSize);

            const metadata = await sharp(compressedBuffer).metadata();
            expect(metadata.format).toBe('png');
            expect(metadata.width).toBeLessThanOrEqual(2000);
            expect(metadata.height).toBeLessThanOrEqual(2000);
        });

        it('compresses a WebP file and reduces its size to fit 2000x2000', async () => {
            const file = await createMockFile(
                'image/webp',
                'image.jpg',
                3000,
                3000,
            );
            const originalSize = file.size;

            const processor = new ImageProcessor(mockLogger);
            const compressedBuffer = await processor.compress(file);

            expect(compressedBuffer.length).toBeLessThan(originalSize);

            const metadata = await sharp(compressedBuffer).metadata();
            expect(metadata.format).toBe('webp');
            expect(metadata.width).toBeLessThanOrEqual(2000);
            expect(metadata.height).toBeLessThanOrEqual(2000);
        });

        it('supports resizing large portrait images to fit 2000x2000', async () => {
            const height = 4000;
            const width = 1000;
            const file = await createMockFile(
                'image/webp',
                'image.jpg',
                width,
                height,
            );
            const originalSize = file.size;

            const processor = new ImageProcessor(mockLogger);
            const compressedBuffer = await processor.compress(file);

            expect(compressedBuffer.length).toBeLessThan(originalSize);

            const metadata = await sharp(compressedBuffer).metadata();
            expect(metadata.format).toBe('webp');
            expect(metadata.width).toBeLessThanOrEqual(2000);
            expect(metadata.height).toBeLessThanOrEqual(2000);
        });

        it('supports resizing large landscape images to fit 2000x2000', async () => {
            const height = 1000;
            const width = 4000;
            const file = await createMockFile(
                'image/webp',
                'image.jpg',
                width,
                height,
            );
            const originalSize = file.size;

            const processor = new ImageProcessor(mockLogger);
            const compressedBuffer = await processor.compress(file);

            expect(compressedBuffer.length).toBeLessThan(originalSize);

            const metadata = await sharp(compressedBuffer).metadata();
            expect(metadata.format).toBe('webp');
            expect(metadata.width).toBeLessThanOrEqual(2000);
            expect(metadata.height).toBeLessThanOrEqual(2000);
        });

        it('does not enlarge small images beyond their original size to fit 2000x2000', async () => {
            const file = await createMockFile(
                'image/jpeg',
                'small-file.jpg',
                400,
                600,
            );

            const processor = new ImageProcessor(mockLogger);
            const compressedBuffer = await processor.compress(file);

            const metadata = await sharp(compressedBuffer).metadata();

            expect(metadata.width).toEqual(600);
            expect(metadata.height).toEqual(400);
            expect(metadata.format).toBe('jpeg');
        });

        it('returns original buffer for unsupported types', async () => {
            const textContent = 'hello world';
            const unsupportedFile = new File([textContent], 'test.txt', {
                type: 'text/plain',
            });
            const originalSize = unsupportedFile.size;

            const processor = new ImageProcessor(mockLogger);
            const compressedBuffer = await processor.compress(unsupportedFile);

            expect(compressedBuffer.length).toEqual(originalSize);
            expect(compressedBuffer.toString()).toBe(textContent);
        });

        it('converts HEIC file to JPEG format', async () => {
            const heicFile = await createMockFile('image/heic', 'photo.heic');

            const processor = new ImageProcessor(mockLogger);
            const compressedBuffer = await processor.compress(heicFile);

            // Verify the output is JPEG format
            const metadata = await sharp(compressedBuffer).metadata();
            expect(metadata.format).toBe('jpeg');
        });

        it('converts HEIF file to JPEG format', async () => {
            const heifFile = await createMockFile('image/heif', 'photo.heif');

            const processor = new ImageProcessor(mockLogger);
            const compressedBuffer = await processor.compress(heifFile);

            // Verify the output is JPEG format
            const metadata = await sharp(compressedBuffer).metadata();
            expect(metadata.format).toBe('jpeg');
        });

        it('returns original buffer if compression fails', async () => {
            const file = await createMockFile(
                'image/jpeg',
                'my-img.jpg',
                1000,
                1000,
            );
            const originalSize = file.size;

            const sharpSpy = vi
                .spyOn(sharp.prototype, 'toBuffer')
                .mockImplementation(() => {
                    throw new Error('Simulated sharp failure');
                });

            const processor = new ImageProcessor(mockLogger);
            const compressedBuffer = await processor.compress(file);

            sharpSpy.mockRestore();

            expect(compressedBuffer).toBeInstanceOf(Buffer);
            expect(compressedBuffer.length).toEqual(originalSize);
        });
    });
});
