import type { Logger } from '@logtape/logtape';
import { type Result, error, ok } from 'core/result';
import sharp from 'sharp';

export type ValidationError = 'file-too-large' | 'file-type-not-supported';

const ALLOWED_IMAGE_TYPES = [
    'image/jpg',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
];

export class ImageProcessor {
    constructor(private readonly logging: Logger) {}

    validate(file: File): Result<boolean, ValidationError> {
        if (file.size > 5 * 1024 * 1024) {
            return error('file-too-large');
        }

        if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
            return error('file-type-not-supported');
        }

        return ok(true);
    }

    async compress(file: File): Promise<File> {
        try {
            const chunks: Buffer[] = [];

            for await (const chunk of file.stream()) {
                if (Buffer.isBuffer(chunk)) {
                    chunks.push(chunk);
                } else {
                    chunks.push(Buffer.from(chunk));
                }
            }
            const fileBuffer = Buffer.concat(chunks);

            const sharpPipeline = sharp(fileBuffer).rotate().resize({
                width: 2000,
                height: 2000,
                fit: 'inside',
                withoutEnlargement: true,
            });

            const format = file.type.split('/')[1];
            let compressedBuffer: Buffer;

            if (
                format === 'jpeg' ||
                format === 'jpg' ||
                format === 'heic' ||
                format === 'heif'
            ) {
                compressedBuffer = await sharpPipeline
                    .jpeg({ quality: 75 })
                    .toBuffer();
            } else if (format === 'png') {
                compressedBuffer = await sharpPipeline
                    .png({ compressionLevel: 9 })
                    .toBuffer();
            } else if (format === 'webp') {
                compressedBuffer = await sharpPipeline
                    .webp({ quality: 75 })
                    .toBuffer();
            } else {
                compressedBuffer = fileBuffer;
            }

            return new File([compressedBuffer], file.name, { type: file.type });
        } catch (error) {
            this.logging.error(
                'Image compression failed, keeping original file',
                {
                    error,
                    fileName: file.name,
                    fileType: file.type,
                },
            );
            return file;
        } finally {
            file.stream().cancel();
        }
    }
}
