import { beforeEach, describe, expect, it, vi } from 'vitest';

import doSanitizeHtml from 'sanitize-html';

import { sanitizeHtml } from './sanitize';

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
        expect(doSanitizeHtml).toHaveBeenCalledWith(unsanitizedContent, {
            allowedTags: ['a', 'p', 'img', 'br', 'strong', 'em', 'span'],
            allowedAttributes: {
                a: ['href'],
                img: ['src'],
            }
        });
    });

    it('should do nothing if content is empty', () => {
        const content = '';

        expect(sanitizeHtml(content)).toEqual(content);
        expect(doSanitizeHtml).not.toHaveBeenCalled();
    });
});
