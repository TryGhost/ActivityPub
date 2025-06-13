import { type Result, getValue, isError, ok } from 'core/result';
import type { StorageAdapter } from './adapters/storage-adapter';
import type { StorageError } from './adapters/storage-adapter';
import type { ImageProcessor, ValidationError } from './image-processor';

export class ImageStorageService {
    constructor(
        private readonly storageAdapter: StorageAdapter,
        private readonly imageProcessor: ImageProcessor,
    ) {}

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
}
