import { v4 as uuidv4 } from 'uuid';

import { getValue, isError, ok, type Result } from '@/core/result';
import type {
    StorageAdapter,
    StorageError,
    VerificationError,
} from '@/storage/adapters/storage-adapter';
import type {
    ImageProcessor,
    ValidationError,
} from '@/storage/image-processor';

export class ImageStorageService {
    constructor(
        private readonly storageAdapter: StorageAdapter,
        private readonly imageProcessor: ImageProcessor,
    ) {}

    async save(
        file: File,
        pathPrefix?: string,
    ): Promise<Result<string, ValidationError | StorageError>> {
        const validationResult = this.imageProcessor.validate(file);
        if (isError(validationResult)) {
            return validationResult;
        }

        const processed = await this.imageProcessor.process(file);
        const uniqueFileName = `${uuidv4()}.${processed.type.split('/')[1]}`;

        const path = pathPrefix
            ? `${pathPrefix.replace(/^\/+|\/+$/g, '')}/${uniqueFileName}`
            : uniqueFileName;

        const savingResult = await this.storageAdapter.save(processed, path);
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
