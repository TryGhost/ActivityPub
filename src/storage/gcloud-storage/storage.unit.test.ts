import type { Bucket } from '@google-cloud/storage';
import { Account } from 'account/account.entity';
import type { AccountService } from 'account/account.service';
import type { Context } from 'hono';
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStorageHandler } from './storage';

describe('Storage Handler', () => {
    let account: Account;
    let accountService: AccountService;
    let mockBucket: Bucket;
    let mockFile: { save: Mock };
    let mockLogger: { error: Mock };
    const getMockContext = (): Context =>
        ({
            get: (key: string) => {
                if (key === 'site') {
                    return {
                        id: 123,
                        host: 'example.com',
                        webhook_secret: 'secret',
                    };
                }
                if (key === 'logger') {
                    return mockLogger;
                }
            },
            req: {
                formData: vi.fn().mockResolvedValue(new FormData()),
            },
        }) as unknown as Context;

    beforeEach(() => {
        process.env.GCP_BUCKET_NAME = 'test-bucket';

        mockLogger = { error: vi.fn() };
        mockFile = { save: vi.fn() };
        const mockFileFn = vi.fn().mockReturnValue(mockFile);
        mockBucket = {
            file: mockFileFn as unknown as Bucket['file'],
            name: 'test-bucket',
        } as unknown as Bucket;

        account = Account.createFromData({
            id: 456,
            uuid: 'f4ec91bd-56b7-406f-a174-91495df6e6c',
            username: 'foobar',
            name: 'Foo Bar',
            bio: 'Just a foo bar',
            avatarUrl: new URL('https://example.com/avatars/foobar.png'),
            bannerImageUrl: new URL('https://example.com/banners/foobar.png'),
            site: {
                id: 123,
                host: 'example.com',
                webhook_secret: 'secret',
            },
            apId: new URL('https://example.com/users/456'),
            url: new URL('https://example.com/users/456'),
            apFollowers: new URL('https://example.com/followers/456'),
        });

        accountService = {
            getAccountForSite: vi.fn().mockResolvedValue(account),
        } as unknown as AccountService;
    });

    it('returns 400 if no file is provided', async () => {
        const ctx = getMockContext();
        const handler = createStorageHandler(accountService, mockBucket);
        const response = await handler(ctx);

        expect(response.status).toBe(400);
        expect(await response.text()).toBe('No file provided');
    });

    it('handles large files', async () => {
        const ctx = getMockContext();
        const largeFile = new globalThis.File(
            ['x'.repeat(26 * 1024 * 1024)],
            'large.jpg',
            { type: 'image/jpeg' },
        );
        const formData = new FormData();
        formData.append('file', largeFile);
        (ctx.req.formData as Mock).mockResolvedValue(formData);

        const handler = createStorageHandler(accountService, mockBucket);
        const response = await handler(ctx);

        expect(response.status).toBe(413);
        expect(await response.text()).toBe('File is too large');
        expect(mockLogger.error).toHaveBeenCalledWith(
            expect.stringContaining('File is too large'),
        );
    });

    it('handles non-supported file types', async () => {
        const ctx = getMockContext();
        const unsupportedFile = new globalThis.File(['test'], 'test.txt', {
            type: 'image/txt',
        });
        const formData = new FormData();
        formData.append('file', unsupportedFile);
        (ctx.req.formData as Mock).mockResolvedValue(formData);

        const handler = createStorageHandler(accountService, mockBucket);
        const response = await handler(ctx);

        expect(response.status).toBe(415);
        expect(await response.text()).toBe(
            `File type ${unsupportedFile.type} is not supported`,
        );
        expect(mockLogger.error).toHaveBeenCalledWith(
            expect.stringContaining(
                `File type ${unsupportedFile.type} is not supported`,
            ),
        );
    });

    it('preserves file extension in storage path', async () => {
        const ctx = getMockContext();
        const testFile = new globalThis.File(['test'], 'test.png', {
            type: 'image/png',
        });
        const formData = new FormData();
        formData.append('file', testFile);
        (ctx.req.formData as Mock).mockResolvedValue(formData);

        const handler = createStorageHandler(accountService, mockBucket);
        await handler(ctx);

        const [storagePath] = (mockBucket.file as Mock).mock.calls[0];
        expect(storagePath).toMatch(/\.png$/);
    });

    it('uploads file and returns file URL', async () => {
        const ctx = getMockContext();

        const mockFileData = new globalThis.File(['test content'], 'test.png', {
            type: 'image/png',
        });
        const formData = new FormData();
        formData.append('file', mockFileData);
        (ctx.req.formData as Mock).mockResolvedValue(formData);

        const handler = createStorageHandler(accountService, mockBucket);
        const response = await handler(ctx);

        expect(response.status).toBe(200);

        const responseData = await response.json();
        expect(responseData.fileUrl).toMatch(/^https?:\/\/.+\/.+$/);

        expect(mockBucket.file).toHaveBeenCalled();
        expect(mockFile.save).toHaveBeenCalled();

        const [stream, options] = (mockFile.save as Mock).mock.calls[0];
        expect(stream).toBeInstanceOf(ReadableStream);
        expect(options.metadata).toEqual({ contentType: 'image/png' });
    });
});
