import { describe, expect, it, vi } from 'vitest';

import type { Logger } from '@logtape/logtape';
import sharp from 'sharp';

import { getError, isError } from '@/core/result';
import { ImageProcessor } from '@/storage/image-processor';

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
        | 'heif'
        | 'gif';

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
        .toFormat(formatForSharp as 'jpeg' | 'png' | 'webp' | 'gif')
        .toBuffer();

    return new File([new Uint8Array(buffer)], fileName, { type });
}

describe('ImageProcessor', () => {
    describe('.validate()', () => {
        it('accepts JPEGs', async () => {
            const processor = new ImageProcessor(mockLogger);
            const file = await createMockFile('image/jpeg', 'image.jpg');
            const result = processor.validate(file);

            expect(isError(result)).toBe(false);
        });

        it('accepts PNGs', async () => {
            const processor = new ImageProcessor(mockLogger);
            const file = await createMockFile('image/png', 'image.png');
            const result = processor.validate(file);

            expect(isError(result)).toBe(false);
        });

        it('accepts WebPs', async () => {
            const processor = new ImageProcessor(mockLogger);
            const file = await createMockFile('image/webp', 'image.webp');
            const result = processor.validate(file);

            expect(isError(result)).toBe(false);
        });

        it('accepts HEICs', async () => {
            const processor = new ImageProcessor(mockLogger);
            const file = await createMockFile('image/heic', 'image.heic');
            const result = processor.validate(file);

            expect(isError(result)).toBe(false);
        });

        it('accepts HEIFs', async () => {
            const processor = new ImageProcessor(mockLogger);
            const file = await createMockFile('image/heif', 'image.heif');
            const result = processor.validate(file);

            expect(isError(result)).toBe(false);
        });

        it('accepts GIFs', async () => {
            const processor = new ImageProcessor(mockLogger);
            const file = await createMockFile('image/gif', 'image.gif');
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
            const file = new File(['test'], 'test.bmp', { type: 'image/bmp' });

            const result = processor.validate(file);

            expect(isError(result)).toBe(true);
            if (isError(result)) {
                expect(getError(result)).toBe('file-type-not-supported');
            }
        });
    });

    describe('.process()', () => {
        it('compresses a JPEG file and reduces its size to fit 2000x2000', async () => {
            const file = await createMockFile(
                'image/jpeg',
                'image.jpg',
                3000,
                3000,
            );
            const originalSize = file.size;

            const processor = new ImageProcessor(mockLogger);
            const processedFile = await processor.process(file);

            expect(processedFile.size).toBeLessThan(originalSize);
            expect(processedFile.name).toBe('image.jpg');
            expect(processedFile.type).toBe('image/jpeg');

            const buffer = Buffer.from(await processedFile.arrayBuffer());
            const metadata = await sharp(buffer).metadata();
            expect(metadata.format).toBe('jpeg');
            expect(metadata.width).toBeLessThanOrEqual(2000);
            expect(metadata.height).toBeLessThanOrEqual(2000);
        });

        it('compresses a PNG file and reduces its size to fit 2000x2000', async () => {
            const file = await createMockFile(
                'image/png',
                'image.png',
                3000,
                3000,
            );
            const originalSize = file.size;

            const processor = new ImageProcessor(mockLogger);
            const processedFile = await processor.process(file);

            expect(processedFile.size).toBeLessThan(originalSize);
            expect(processedFile.name).toBe('image.png');
            expect(processedFile.type).toBe('image/png');

            const buffer = Buffer.from(await processedFile.arrayBuffer());
            const metadata = await sharp(buffer).metadata();
            expect(metadata.format).toBe('png');
            expect(metadata.width).toBeLessThanOrEqual(2000);
            expect(metadata.height).toBeLessThanOrEqual(2000);
        });

        it('compresses a WebP file and reduces its size to fit 2000x2000', async () => {
            const file = await createMockFile(
                'image/webp',
                'image.webp',
                3000,
                3000,
            );
            const originalSize = file.size;

            const processor = new ImageProcessor(mockLogger);
            const processedFile = await processor.process(file);

            expect(processedFile.size).toBeLessThan(originalSize);
            expect(processedFile.name).toBe('image.webp');
            expect(processedFile.type).toBe('image/webp');

            const buffer = Buffer.from(await processedFile.arrayBuffer());
            const metadata = await sharp(buffer).metadata();
            expect(metadata.format).toBe('webp');
            expect(metadata.width).toBeLessThanOrEqual(2000);
            expect(metadata.height).toBeLessThanOrEqual(2000);
        });

        it('supports resizing large portrait images to fit 2000x2000', async () => {
            const height = 4000;
            const width = 1000;
            const file = await createMockFile(
                'image/webp',
                'portrait.webp',
                width,
                height,
            );
            const originalSize = file.size;

            const processor = new ImageProcessor(mockLogger);
            const processedFile = await processor.process(file);

            expect(processedFile.size).toBeLessThan(originalSize);

            const buffer = Buffer.from(await processedFile.arrayBuffer());
            const metadata = await sharp(buffer).metadata();
            expect(metadata.format).toBe('webp');
            expect(metadata.width).toBeLessThanOrEqual(2000);
            expect(metadata.height).toBeLessThanOrEqual(2000);
        });

        it('supports resizing large landscape images to fit 2000x2000', async () => {
            const height = 1000;
            const width = 4000;
            const file = await createMockFile(
                'image/webp',
                'landscape.webp',
                width,
                height,
            );
            const originalSize = file.size;

            const processor = new ImageProcessor(mockLogger);
            const processedFile = await processor.process(file);

            expect(processedFile.size).toBeLessThan(originalSize);

            const buffer = Buffer.from(await processedFile.arrayBuffer());
            const metadata = await sharp(buffer).metadata();
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
            const processedFile = await processor.process(file);

            const buffer = Buffer.from(await processedFile.arrayBuffer());
            const metadata = await sharp(buffer).metadata();

            expect(metadata.width).toEqual(600);
            expect(metadata.height).toEqual(400);
            expect(metadata.format).toBe('jpeg');
        });

        it('converts HEIC file to JPEG format for web compatibility', async () => {
            const heicFile = await createMockFile('image/heic', 'photo.heic');

            const processor = new ImageProcessor(mockLogger);
            const processedFile = await processor.process(heicFile);

            expect(processedFile.name).toBe('photo.jpg');
            expect(processedFile.type).toBe('image/jpeg');

            // Verify the output is JPEG format
            const buffer = Buffer.from(await processedFile.arrayBuffer());
            const metadata = await sharp(buffer).metadata();
            expect(metadata.format).toBe('jpeg');
        });

        it('converts HEIF file to JPEG format for web compatibility', async () => {
            const heifFile = await createMockFile('image/heif', 'photo.heif');

            const processor = new ImageProcessor(mockLogger);
            const processedFile = await processor.process(heifFile);

            expect(processedFile.name).toBe('photo.jpg');
            expect(processedFile.type).toBe('image/jpeg');

            // Verify the output is JPEG format
            const buffer = Buffer.from(await processedFile.arrayBuffer());
            const metadata = await sharp(buffer).metadata();
            expect(metadata.format).toBe('jpeg');
        });

        it('returns original file for GIFs, as commpression may produce larger files than the input', async () => {
            const gifFile = await createMockFile(
                'image/gif',
                'photo.gif',
                3000,
                3000,
            );

            const processor = new ImageProcessor(mockLogger);
            const processedFile = await processor.process(gifFile);

            expect(processedFile).toBe(gifFile);
            expect(processedFile.name).toBe('photo.gif');
            expect(processedFile.type).toBe('image/gif');
        });

        it('returns original file for unsupported types', async () => {
            const textContent = 'hello world';
            const unsupportedFile = new File([textContent], 'test.txt', {
                type: 'text/plain',
            });
            const originalSize = unsupportedFile.size;

            const processor = new ImageProcessor(mockLogger);
            const processedFile = await processor.process(unsupportedFile);

            expect(processedFile.size).toEqual(originalSize);
            expect(processedFile.name).toBe('test.txt');
            expect(processedFile.type).toBe('text/plain');

            const text = await processedFile.text();
            expect(text).toBe(textContent);
        });

        it('returns original file if compression fails', async () => {
            const file = await createMockFile(
                'image/jpeg',
                'my-img.jpg',
                1000,
                1000,
            );

            const sharpSpy = vi
                .spyOn(sharp.prototype, 'toBuffer')
                .mockImplementation(() => {
                    throw new Error('Simulated sharp failure');
                });

            const processor = new ImageProcessor(mockLogger);
            const processedFile = await processor.process(file);

            sharpSpy.mockRestore();

            expect(processedFile).toBeInstanceOf(File);
            expect(processedFile).toBe(file);
            expect(processedFile.name).toBe('my-img.jpg');
            expect(processedFile.type).toBe('image/jpeg');
        });
    });
});
