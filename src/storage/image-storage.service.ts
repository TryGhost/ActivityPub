import { type Result, isError, ok } from 'core/result';
import type { StorageAdapter } from './adapters/storage-adapter';
import type { FileValidationError, ImageProcessor } from './image-processor';

export class ImageStorageService {
    constructor(
        private readonly storageAdapter: StorageAdapter,
        private readonly imageProcessor: ImageProcessor,
    ) {}

    async save(
        file: File,
        path: string,
    ): Promise<Result<string, FileValidationError>> {
        const validationResult = this.imageProcessor.validate(file);
        if (isError(validationResult)) {
            return validationResult;
        }

        const compressed = await this.imageProcessor.compress(file);

        const fileUrl = await this.storageAdapter.save(compressed, path);
        return ok(fileUrl);
    }
}
