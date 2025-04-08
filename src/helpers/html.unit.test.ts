import { beforeEach, describe, expect, it, vi } from 'vitest';

import doSanitizeHtml from 'sanitize-html';

import { escapeHtml, sanitizeHtml } from './html';

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
            allowedTags: [
                'address',
                'img',
                'article',
                'aside',
                'footer',
                'header',
                'h1',
                'h2',
                'h3',
                'h4',
                'h5',
                'h6',
                'hgroup',
                'main',
                'nav',
                'section',
                'blockquote',
                'dd',
                'div',
                'dl',
                'dt',
                'figcaption',
                'figure',
                'hr',
                'li',
                'main',
                'ol',
                'p',
                'pre',
                'ul',
                'a',
                'abbr',
                'b',
                'bdi',
                'bdo',
                'br',
                'cite',
                'code',
                'data',
                'dfn',
                'em',
                'i',
                'kbd',
                'mark',
                'q',
                'rb',
                'rp',
                'rt',
                'rtc',
                'ruby',
                's',
                'samp',
                'script',
                'small',
                'span',
                'strong',
                'sub',
                'sup',
                'time',
                'u',
                'var',
                'wbr',
                'caption',
                'col',
                'colgroup',
                'table',
                'tbody',
                'td',
                'tfoot',
                'th',
                'thead',
                'tr',
                'svg',
                'defs',
                'iframe',
                'rect',
                'polyline',
                'line',
                'circle',
                'button',
                'input',
                'path',
                'audio',
                'video',
            ],
            allowedClasses: {
                '*': false,
            },
            allowedAttributes: {
                // Global attributes
                '*': [
                    'id',
                    'class',
                    'title',
                    'lang',
                    'dir',
                    'tabindex',
                    'style',
                ],

                // Specific HTML elements
                a: ['href', 'target', 'rel', 'download', 'hreflang', 'type'],
                img: [
                    'src',
                    'srcset',
                    'alt',
                    'title',
                    'width',
                    'height',
                    'loading',
                ],
                audio: [
                    'src',
                    'autoplay',
                    'controls',
                    'loop',
                    'muted',
                    'preload',
                ],
                video: [
                    'src',
                    'autoplay',
                    'controls',
                    'loop',
                    'muted',
                    'preload',
                    'poster',
                    'width',
                    'height',
                ],
                button: [
                    'type',
                    'disabled',
                    'form',
                    'formaction',
                    'formenctype',
                    'formmethod',
                    'formnovalidate',
                    'formtarget',
                    'name',
                    'value',
                ],
                input: [
                    'type',
                    'accept',
                    'alt',
                    'autocomplete',
                    'autofocus',
                    'checked',
                    'disabled',
                    'form',
                    'formaction',
                    'formenctype',
                    'formmethod',
                    'formnovalidate',
                    'formtarget',
                    'list',
                    'max',
                    'maxlength',
                    'min',
                    'minlength',
                    'multiple',
                    'name',
                    'pattern',
                    'placeholder',
                    'readonly',
                    'required',
                    'size',
                    'src',
                    'step',
                    'value',
                ],
                table: ['border', 'cellpadding', 'cellspacing'],
                td: ['colspan', 'rowspan', 'headers'],
                th: ['colspan', 'rowspan', 'headers', 'scope'],

                // SVG elements
                svg: [
                    'viewBox',
                    'width',
                    'height',
                    'viewbox',
                    'preserveAspectRatio',
                    'xmlns',
                ],
                circle: ['cx', 'cy', 'r', 'fill', 'stroke', 'stroke-width'],
                rect: [
                    'x',
                    'y',
                    'width',
                    'height',
                    'rx',
                    'ry',
                    'fill',
                    'stroke',
                    'stroke-width',
                ],
                line: ['x1', 'y1', 'x2', 'y2', 'stroke', 'stroke-width'],
                polyline: ['points', 'fill', 'stroke', 'stroke-width'],
                path: ['d', 'fill', 'stroke', 'stroke-width'],
                text: ['x', 'y', 'font-family', 'font-size', 'fill'],
                g: ['transform'],
                defs: [],
                style: ['type'],
                iframe: [
                    'src',
                    'width',
                    'height',
                    'frameborder',
                    'allowfullscreen',
                ],
                script: ['src', 'async', 'charset'],
            },
            allowedScriptDomains: ['twitter.com'],
            allowedScriptHostnames: ['platform.twitter.com'],
            allowVulnerableTags: true,
        });
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

describe('escapeHtml', () => {
    it('should return the provided content escaped of any HTML', () => {
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
            expect(escapeHtml(input)).toEqual(output);
        }
    });
});
