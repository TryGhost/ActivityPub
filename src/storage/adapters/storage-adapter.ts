export interface StorageAdapter {
    init(): Promise<void>;
    save(file: File, path: string): Promise<string>;
}
