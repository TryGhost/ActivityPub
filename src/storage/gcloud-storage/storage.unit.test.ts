import { Storage } from '@google-cloud/storage';
import { Account } from 'account/account.entity';
import type { AccountService } from 'account/account.service';
import type { Context } from 'hono';
import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStorageHandler } from './storage';

vi.mock('@google-cloud/storage', () => ({
    Storage: vi.fn(),
}));

describe('Storage Handler', () => {
    let account: Account;
    let accountService: AccountService;
    let mockStorage: { bucket: Mock };
    let mockBucket: { file: Mock };
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
        mockBucket = { file: vi.fn().mockReturnValue(mockFile) };
        mockStorage = { bucket: vi.fn().mockReturnValue(mockBucket) };

        (Storage as unknown as Mock).mockImplementation(() => mockStorage);

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
        const handler = createStorageHandler(accountService);
        const response = await handler(ctx);

        expect(response.status).toBe(400);
        expect(await response.text()).toBe('No file provided');
    });

    it('uploads file and returns file URL', async () => {
        const ctx = getMockContext();

        const mockFileData = new File(['test content'], 'test.txt', {
            type: 'text/plain',
        });
        const formData = new FormData();
        formData.append('file', mockFileData);
        (ctx.req.formData as Mock).mockResolvedValue(formData);

        const handler = createStorageHandler(accountService);
        const response = await handler(ctx);

        expect(response.status).toBe(200);

        const responseData = await response.json();
        expect(responseData.fileUrl).toMatch(
            /^https:\/\/storage.googleapis.com\/test-bucket\/images\/f4ec91bd-56b7-406f-a174-91495df6e6c\/[a-f0-9-]+$/,
        );

        expect(mockStorage.bucket).toHaveBeenCalledWith('test-bucket');
        expect(mockBucket.file).toHaveBeenCalled();
        expect(mockFile.save).toHaveBeenCalled();

        const [stream, options] = (mockFile.save as Mock).mock.calls[0];
        expect(stream).toBeInstanceOf(ReadableStream);
        expect(options).toEqual({ metadata: { contentType: 'text/plain' } });
    });

    it('handles storage errors and returns empty response', async () => {
        const ctx = getMockContext();

        const mockFileData = new File(['test content'], 'test.txt', {
            type: 'text/plain',
        });
        const formData = new FormData();
        formData.append('file', mockFileData);
        (ctx.req.formData as Mock).mockResolvedValue(formData);

        (mockFile.save as Mock).mockRejectedValue(new Error('Storage error'));

        const handler = createStorageHandler(accountService);
        const response = await handler(ctx);

        expect(response.status).toBe(200);
        expect(await response.text()).toBe(JSON.stringify({}));
    });
});
