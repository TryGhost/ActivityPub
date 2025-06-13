import { type Result, getValue, isError, ok } from 'core/result';
import { v4 as uuidv4 } from 'uuid';
import type {
    StorageAdapter,
    StorageError,
    VerificationError,
} from './adapters/storage-adapter';
import type { ImageProcessor, ValidationError } from './image-processor';

export class ImageStorageService {
    constructor(
        private readonly storageAdapter: StorageAdapter,
        private readonly imageProcessor: ImageProcessor,
    ) {}

    storagePath(file: File, accountUUID: string): string {
        // HEIC/HEIF files are converted to JPEG format
        const isHeicFile =
            file.type.includes('heic') || file.type.includes('heif');
        const extension = isHeicFile ? 'jpg' : file.type.split('/')[1];

        return `/images/${accountUUID}/${uuidv4()}.${extension}`;
    }

    async save(
        file: File,
        path: string,
    ): Promise<Result<string, ValidationError | StorageError>> {
        const validationResult = this.imageProcessor.validate(file);
        if (isError(validationResult)) {
            return validationResult;
        }

        const compressed = await this.imageProcessor.compress(file);

        const savingResult = await this.storageAdapter.save(compressed, path);
        if (isError(savingResult)) {
            return savingResult;
        }

        const fileUrl = getValue(savingResult);
        return ok(fileUrl);
    }

    async verifyFileUrl(url: URL): Promise<Result<boolean, VerificationError>> {
        return this.storageAdapter.verifyFileUrl(url);
    }
}
