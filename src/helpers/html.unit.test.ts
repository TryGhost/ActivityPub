import { beforeEach, describe, expect, it, vi } from 'vitest';

import { htmlToText } from 'html-to-text';
import doSanitizeHtml from 'sanitize-html';

import { normalizePlainText, sanitizeHtml } from '@/helpers/html';

vi.mock('sanitize-html');
vi.mock('html-to-text');

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

describe('normalizePlainText', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should normalize HTML content to plain text', () => {
        vi.mocked(htmlToText).mockReturnValue('  sanitized   title  ');

        expect(normalizePlainText('<h1>  sanitized title  </h1>')).toEqual(
            'sanitized title',
        );

        expect(htmlToText).toHaveBeenCalledWith(
            '<h1>  sanitized title  </h1>',
            {
                wordwrap: false,
                preserveNewlines: true,
                selectors: [
                    { selector: 'img', format: 'skip' },
                    { selector: 'script', format: 'skip' },
                    { selector: 'style', format: 'skip' },
                    { selector: 'noscript', format: 'skip' },
                    { selector: 'a', options: { ignoreHref: true } },
                    { selector: 'h1', format: 'inline' },
                    { selector: 'h2', format: 'inline' },
                    { selector: 'h3', format: 'inline' },
                    { selector: 'h4', format: 'inline' },
                    { selector: 'h5', format: 'inline' },
                    { selector: 'h6', format: 'inline' },
                ],
            },
        );
    });

    it('should preserve punctuation like ampersands and angle brackets', async () => {
        // Clear the mock and let the real implementation take over
        vi.doUnmock('html-to-text');
        vi.resetModules();

        // Dynamically import the modules again to get fresh copies
        await import('html-to-text');
        const { normalizePlainText: realNormalizePlainText } = await import(
            './html'
        );

        expect(realNormalizePlainText('Q&A Session')).toEqual('Q&A Session');
        expect(realNormalizePlainText('AT&T')).toEqual('AT&T');
        expect(realNormalizePlainText('5 < 7')).toEqual('5 < 7');

        // Restore the mock for subsequent tests
        vi.mock('html-to-text');
        vi.resetModules();
    });

    it('should do nothing if content is empty', () => {
        expect(normalizePlainText('')).toEqual('');
        expect(htmlToText).not.toHaveBeenCalled();
    });
});
