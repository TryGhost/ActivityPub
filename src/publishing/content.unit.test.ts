import { describe, expect, it } from 'vitest';
import { ContentPreparer, MEMBER_CONTENT_MARKER } from './content';

describe('ContentPreparer', () => {
    const preparer = new ContentPreparer();

    describe('prepare', () => {
        describe('Removing member content', () => {
            it('should remove member content', () => {
                const content = `Hello, world!${MEMBER_CONTENT_MARKER}Member content`;
                const result = preparer.prepare(content, {
                    removeMemberContent: true,
                });

                expect(result).toEqual('Hello, world!');
            });

            it('should not remove member by default', () => {
                const content = `Hello, world!${MEMBER_CONTENT_MARKER}Member content`;
                const result = preparer.prepare(content);

                expect(result).toEqual(content);
            });
        });

        describe('Escaping HTML', () => {
            it('should escape HTML', () => {
                const content = '<p>Hello, world!</p>';
                const result = preparer.prepare(content, {
                    escapeHtml: true,
                });

                expect(result).toEqual('&lt;p&gt;Hello, world!&lt;&#x2F;p&gt;');
            });

            it('should not escape HTML by default', () => {
                const content = '<p>Hello, world!</p>';
                const result = preparer.prepare(content);

                expect(result).toEqual(content);
            });
        });

        describe('Converting line breaks', () => {
            it('should convert line breaks to HTML', () => {
                const content = 'Hello, world!\nThis is a new line';
                const result = preparer.prepare(content, {
                    convertLineBreaks: true,
                });

                expect(result).toEqual('Hello, world!<br />This is a new line');
            });

            it('should convert line breaks to HTML with multiple line breaks', () => {
                const content = 'Hello, world!\n\nThis is a new line';
                const result = preparer.prepare(content, {
                    convertLineBreaks: true,
                });

                expect(result).toEqual(
                    'Hello, world!<br /><br />This is a new line',
                );
            });

            it('should not convert line breaks by default', () => {
                const content = 'Hello, world!\nThis is a new line';
                const result = preparer.prepare(content);

                expect(result).toEqual(content);
            });
        });

        describe('Wrapping in paragraph', () => {
            it('should wrap in paragraph', () => {
                const content = 'Hello, world!';
                const result = preparer.prepare(content, {
                    wrapInParagraph: true,
                });

                expect(result).toEqual('<p>Hello, world!</p>');
            });

            it('should not wrap in paragraph by default', () => {
                const content = 'Hello, world!';
                const result = preparer.prepare(content);

                expect(result).toEqual(content);
            });
        });
    });

    describe('regenerateExcerpt', () => {
        it('returns the original content as text if shorter than the limit', () => {
            const content = '<p>Hello, world!</p>';
            const result = preparer.regenerateExcerpt(content);

            expect(result).toEqual('Hello, world!');
        });

        it('truncates the content if longer than the limit', () => {
            const content =
                '<p>I expect content to be truncated exactly here and the rest of the content to not be part of the excerpt</p>';
            const result = preparer.regenerateExcerpt(content, 48);

            expect(result).toEqual(
                'I expect content to be truncated exactly here...',
            );
            expect(result.length).toEqual(48);
        });

        it('should ignore <img> tags', () => {
            const content =
                '<img src="https://example.com/image.jpg" /><p>I expect content to be truncated exactly here and the rest of the content to not be part of the excerpt</p>';
            const result = preparer.regenerateExcerpt(content, 48);

            expect(result).toEqual(
                'I expect content to be truncated exactly here...',
            );
            expect(result.length).toEqual(48);
        });

        it('should remove <a> href attributes', () => {
            const content =
                '<a href="https://example.com/image.jpg" />Link.</a><p>I expect content to be truncated exactly here and the rest of the content to not be part of the excerpt</p>';
            const result = preparer.regenerateExcerpt(content, 55);

            expect(result).toEqual(
                'Link.\n\nI expect content to be truncated exactly here...',
            );
            expect(result.length).toEqual(55);
        });
    });
});
