import type { Result } from '@/core/result';

export type StorageError = 'error-saving-file';
export type VerificationError =
    | 'invalid-url'
    | 'file-not-found'
    | 'invalid-file-path';

export interface StorageAdapter {
    save(file: File, path: string): Promise<Result<string, StorageError>>;
    verifyFileUrl(url: URL): Promise<Result<boolean, VerificationError>>;
}
