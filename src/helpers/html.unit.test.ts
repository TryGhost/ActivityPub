import { beforeEach, describe, expect, it, vi } from 'vitest';

import doSanitizeHtml from 'sanitize-html';

import { sanitizeHtml } from '@/helpers/html';

vi.mock('sanitize-html');

describe('sanitizeHtml', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return the provided content sanitized of any HTML', () => {
        const unsanitizedContent = 'unsanitized content';
        const sanitizedContent = 'sanitized content';

        vi.mocked(doSanitizeHtml).mockReturnValue(sanitizedContent);

        expect(sanitizeHtml(unsanitizedContent)).toEqual(sanitizedContent);
    });

    it('should do nothing if content is empty', () => {
        const content = '';

        expect(sanitizeHtml(content)).toEqual(content);
        expect(doSanitizeHtml).not.toHaveBeenCalled();
    });

    it('should only allow scripts from allowed domains', async () => {
        // Clear the mock and let the real implementation take over
        vi.doUnmock('sanitize-html');
        vi.resetModules();

        // Dynamically import the modules again to get fresh copies
        await import('sanitize-html');
        const { sanitizeHtml: realSanitizeHtml } = await import('./html');

        const content =
            '<script src="https://bad.com/script.js"></script><script src="https://twitter.com/script.js"></script><p>Hello, world!</p>';

        const result = realSanitizeHtml(content);

        expect(result).toEqual(
            '<script></script><script src="https://twitter.com/script.js"></script><p>Hello, world!</p>',
        );

        // Restore the mock for subsequent tests
        vi.mock('sanitize-html');
        vi.resetModules();
    });
});
