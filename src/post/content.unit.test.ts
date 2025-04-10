import { describe, expect, it } from 'vitest';
import {
    ContentPreparer,
    MEMBER_CONTENT_MARKER,
    PAID_CONTENT_PREVIEW_HTML,
} from './content';

describe('ContentPreparer', () => {
    const preparer = new ContentPreparer();

    describe('prepare', () => {
        const allOptionsDisabled = {
            removeMemberContent: false,
            escapeHtml: false,
            convertLineBreaks: false,
            wrapInParagraph: false,
            extractLinks: false,
            addPaidContentMessage: false as const,
        };

        describe('Removing member content', () => {
            it('should remove member content', () => {
                const content = `Hello, world!${MEMBER_CONTENT_MARKER}Member content`;
                const result = preparer.prepare(content, {
                    ...allOptionsDisabled,
                    removeMemberContent: true,
                });

                expect(result).toEqual('Hello, world!');
            });

            it('should remove all content if no marker is found', () => {
                const content = 'This whole thing is member content';
                const result = preparer.prepare(content, {
                    ...allOptionsDisabled,
                    removeMemberContent: true,
                });

                expect(result).toEqual('');
            });

            it('should not remove member by default', () => {
                const content = `Hello, world!${MEMBER_CONTENT_MARKER}Member content`;
                const result = preparer.prepare(content);

                expect(result).toEqual(content);
            });
        });

        describe('Escaping HTML', () => {
            it('should escape HTML', () => {
                const testCases = [
                    {
                        input: '<p>Hello, world!</p>',
                        output: '&lt;p&gt;Hello, world!&lt;&#x2F;p&gt;',
                    },
                    {
                        input: 'Lorem ipsum dolor <img src="https://example.com/image.jpg" />',
                        output: 'Lorem ipsum dolor &lt;img src=&quot;https:&#x2F;&#x2F;example.com&#x2F;image.jpg&quot; &#x2F;&gt;',
                    },
                    {
                        input: '<script>alert("Hello, world!");</script>',
                        output: '&lt;script&gt;alert(&quot;Hello, world!&quot;);&lt;&#x2F;script&gt;',
                    },
                    {
                        input: 'Lorem ipsum dolor sit amet',
                        output: 'Lorem ipsum dolor sit amet',
                    },
                    {
                        input: '',
                        output: '',
                    },
                ];

                for (const { input, output } of testCases) {
                    const result = preparer.prepare(input, {
                        ...allOptionsDisabled,
                        escapeHtml: true,
                    });
                    expect(result).toEqual(output);
                }
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
                    ...allOptionsDisabled,
                    convertLineBreaks: true,
                });

                expect(result).toEqual('Hello, world!<br />This is a new line');
            });

            it('should convert line breaks to HTML with multiple line breaks', () => {
                const content = 'Hello, world!\n\nThis is a new line';
                const result = preparer.prepare(content, {
                    ...allOptionsDisabled,
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
                    ...allOptionsDisabled,
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

        describe('Adding paid content message', () => {
            it('should add paid content message when enabled', () => {
                const content = '<p>Hello, world!</p>';
                const result = preparer.prepare(content, {
                    ...allOptionsDisabled,
                    addPaidContentMessage: {
                        url: new URL('https://hello.world'),
                    },
                });

                expect(result).toEqual(
                    `<p>Hello, world!</p>${PAID_CONTENT_PREVIEW_HTML(new URL('https://hello.world'))}`,
                );
            });

            it('should not add paid content message by default', () => {
                const content = '<p>Hello, world!</p>';
                const result = preparer.prepare(content);

                expect(result).toEqual(content);
            });
        });
    });

    describe('regenerateExcerpt', () => {
        it('returns the original content as text if shorter than the limit', () => {
            const content = '<p>Hello, world!</p>';
            const result = preparer.regenerateExcerpt(content, 500);

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

        it('should ignore <figcaption> tags', () => {
            const content =
                '<figcaption>This is a caption</figcaption><p>I expect content to be truncated exactly here and the rest of the content to not be part of the excerpt</p>';
            const result = preparer.regenerateExcerpt(content, 48);

            expect(result).toEqual(
                'I expect content to be truncated exactly here...',
            );
            expect(result.length).toEqual(48);
        });

        it('should ignore <hr> tags', () => {
            const content =
                '<hr /><p>I expect content to be truncated exactly here and the rest of the content to not be part of the excerpt</p>';
            const result = preparer.regenerateExcerpt(content, 48);

            expect(result).toEqual(
                'I expect content to be truncated exactly here...',
            );
        });
    });
});
