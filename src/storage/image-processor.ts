import type { Logger } from '@logtape/logtape';
import { type Result, error, ok } from 'core/result';
import sharp from 'sharp';

export type FileValidationError = 'file-too-large' | 'file-type-not-supported';

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

    validate(file: File): Result<boolean, FileValidationError> {
        if (file.size > 5 * 1024 * 1024) {
            return error('file-too-large');
        }

        if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
            return error('file-type-not-supported');
        }

        return ok(true);
    }

    async compress(file: File): Promise<Buffer> {
        const chunks: Buffer[] = [];

        for await (const chunk of file.stream()) {
            if (Buffer.isBuffer(chunk)) {
                chunks.push(chunk);
            } else {
                chunks.push(Buffer.from(chunk));
            }
        }
        const fileBuffer = Buffer.concat(chunks);

        try {
            const sharpPipeline = sharp(fileBuffer).rotate().resize({
                width: 2000,
                height: 2000,
                fit: 'inside',
                withoutEnlargement: true,
            });

            const format = file.type.split('/')[1];

            if (
                format === 'jpeg' ||
                format === 'jpg' ||
                format === 'heic' ||
                format === 'heif'
            ) {
                return sharpPipeline.jpeg({ quality: 75 }).toBuffer();
            }

            if (format === 'png') {
                return sharpPipeline.png({ compressionLevel: 9 }).toBuffer();
            }

            if (format === 'webp') {
                return sharpPipeline.webp({ quality: 75 }).toBuffer();
            }

            return fileBuffer;
        } catch (error) {
            this.logging.error(
                'Image compression failed, keeping original file',
                {
                    error,
                    fileName: file.name,
                    fileType: file.type,
                },
            );
            return fileBuffer;
        }
    }
}
