import doSanitizeHtml from 'sanitize-html';

export function sanitizeHtml(content: string): string {
    if (!content) {
        return content;
    }

    return doSanitizeHtml(content, {
        allowedTags: ['a', 'p', 'img', 'br', 'strong', 'em', 'span'],
        allowedAttributes: {
            a: ['href'],
            img: ['src'],
        }
    });
}
