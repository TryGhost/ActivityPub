import { beforeEach, describe, expect, it, vi } from 'vitest';

import doSanitizeHtml from 'sanitize-html';

import { normalizePlainText, sanitizeHtml } from '@/helpers/html';

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

describe('normalizePlainText', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should normalize HTML content to plain text', () => {
        const content = `
            <h1>Heading 1</h1>
            <h2>Heading 2</h2>
            <h3>Heading 3</h3>
            <h4>Heading 4</h4>
            <h5>Heading 5</h5>
            <h6>Heading 6</h6>
            <a href="https://example.com">example link</a>
            <img src="https://example.com/image.jpg" alt="ignored image" />
            <script>alert('xss')</script>
            <style>body { color: red; }</style>
            <noscript>fallback content</noscript>
        `;

        expect(normalizePlainText(content)).toEqual(
            'Heading 1 Heading 2 Heading 3 Heading 4 Heading 5 Heading 6 example link',
        );
    });

    it('should preserve punctuation like ampersands and angle brackets', () => {
        expect(normalizePlainText('Q&A Session')).toEqual('Q&A Session');
        expect(normalizePlainText('AT&T')).toEqual('AT&T');
        expect(normalizePlainText('5 < 7')).toEqual('5 < 7');
    });

    it('should do nothing if content is empty', () => {
        expect(normalizePlainText('')).toEqual('');
    });
});
