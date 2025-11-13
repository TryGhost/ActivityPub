import type { Logger } from '@logtape/logtape';
import sharp from 'sharp';

import { error, ok, type Result } from '@/core/result';

export type ValidationError = 'file-too-large' | 'file-type-not-supported';

const ALLOWED_IMAGE_TYPES = [
    'image/jpg',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'image/gif',
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

    async process(file: File): Promise<File> {
        try {
            const fileBuffer = Buffer.from(await file.arrayBuffer());

            const basePipeline = sharp(fileBuffer, { animated: true })
                .rotate()
                .resize({
                    width: 2000,
                    height: 2000,
                    fit: 'inside',
                    withoutEnlargement: true,
                });

            let pipeline = basePipeline;
            let targetType = file.type;
            let targetName = file.name;

            switch (file.type) {
                case 'image/jpeg':
                case 'image/jpg':
                    pipeline = basePipeline.jpeg({ quality: 75 });
                    break;
                case 'image/png':
                    pipeline = basePipeline.png({ compressionLevel: 9 });
                    break;
                case 'image/webp':
                    pipeline = basePipeline.webp({ quality: 75 });
                    break;
                // Note: HEIC/HEIF are converted to JPEG for web compatibility
                case 'image/heic':
                case 'image/heif':
                    pipeline = basePipeline.jpeg({ quality: 75 });
                    targetType = 'image/jpeg';
                    targetName = file.name.replace(/\.(heic|heif)$/i, '.jpg');
                    break;
                // Note: GIFs are not compressed, as compression may produce larger files than the input
                // See: https://github.com/lovell/sharp/issues/3610)
                case 'image/gif':
                    return file;
                default:
                    return file;
            }

            const processed = await pipeline.toBuffer();

            return new File([new Uint8Array(processed)], targetName, {
                type: targetType,
            });
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
        }
    }
}
