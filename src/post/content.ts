import { htmlToText } from 'html-to-text';
import linkifyHtml from 'linkify-html';

/**
 * Marker to indicate that the proceeding content is member content
 */
export const MEMBER_CONTENT_MARKER = '<!--members-only-->';

/**
 * Paid content preview message added to non-public posts
 */
export const PAID_CONTENT_PREVIEW_HTML = (url: URL) =>
    `<div class="gh-paid-content-notice"><h3>Upgrade to continue reading</h3><p>Become a paid member to get access to all premium content</p><a class="gh-paid-content-cta" href="${url.href}#/portal/signup">Upgrade</a></div>`;

/**
 * Options for preparing content
 */
interface PrepareContentOptions {
    /**
     * Whether to remove member content
     */
    removeMemberContent: boolean;
    /**
     * Whether to escape HTML
     */
    escapeHtml: boolean;
    /**
     * Whether to convert line breaks to HTML
     */
    convertLineBreaks: boolean;
    /**
     * Whether to wrap in a paragraph
     */
    wrapInParagraph: boolean;
    /**
     * Convert URL's to anchor tags
     */
    extractLinks: boolean;
    /**
     * Whether to add paid content preview message
     */
    addPaidContentMessage:
        | false
        | {
              url: URL;
          };
}

export class ContentPreparer {
    static instance = new ContentPreparer();

    static prepare(
        content: string,
        options: PrepareContentOptions = {
            removeMemberContent: false,
            escapeHtml: false,
            convertLineBreaks: false,
            wrapInParagraph: false,
            extractLinks: false,
            addPaidContentMessage: false,
        },
    ) {
        return ContentPreparer.instance.prepare(content, options);
    }

    static regenerateExcerpt(html: string, charLimit = 500) {
        return ContentPreparer.instance.regenerateExcerpt(html, charLimit);
    }

    /**
     * Prepare the content
     *
     * @param content Content to prepare
     * @param options Options for preparing the content
     */
    prepare(
        content: string,
        options: PrepareContentOptions = {
            removeMemberContent: false,
            escapeHtml: false,
            convertLineBreaks: false,
            wrapInParagraph: false,
            extractLinks: false,
            addPaidContentMessage: false,
        },
    ) {
        let prepared = content;

        if (options.removeMemberContent === true) {
            prepared = this.removeMemberContent(prepared);
        }

        if (options.escapeHtml === true) {
            prepared = this.escapeHtml(prepared);
        }

        if (options.extractLinks === true) {
            prepared = this.extractLinks(prepared);
        }

        if (options.convertLineBreaks === true) {
            prepared = this.convertLineBreaks(prepared);
        }

        if (options.wrapInParagraph === true) {
            prepared = this.wrapInParagraph(prepared);
        }

        if (options.addPaidContentMessage !== false) {
            prepared = this.addPaidContentMessage(
                prepared,
                options.addPaidContentMessage.url,
            );
        }

        return prepared;
    }

    /**
     * Add paid content preview message to the content
     *
     * @param content Content to add the message to
     */
    private addPaidContentMessage(content: string, url: URL) {
        return content + PAID_CONTENT_PREVIEW_HTML(url);
    }

    /**
     * Replace URLs in a string with an anchor tag pointing
     * to the URL and with the text content of the URL
     */
    private extractLinks(html: string): string {
        const options = {
            defaultProtocol: 'https',
            attributes: {},
            validate(_url: unknown, type: string) {
                return type === 'url';
            },
        };
        return linkifyHtml(html, options);
    }

    /**
     * Re-generate excerpt from HTML content, based on a character limit
     *
     * @param html HTML content to generate an excerpt from
     * @param charLimit Character limit for the excerpt
     */
    regenerateExcerpt(html: string, charLimit: number) {
        const text = htmlToText(html, {
            wordwrap: false,
            preserveNewlines: true,
            selectors: [
                { selector: 'img', format: 'skip' },
                { selector: 'div', format: 'inline' },
                { selector: 'a', options: { ignoreHref: true } },
                { selector: 'figcaption', format: 'skip' },
                { selector: 'a[rel=footnote]', format: 'skip' },
                { selector: 'div.footnotes', format: 'skip' },
                { selector: 'hr', format: 'skip' },
                { selector: 'blockquote', format: 'block' },
                { selector: '.kg-signup-card', format: 'skip' },
            ],
        }).trim();

        if (text.length <= charLimit) {
            return text;
        }

        return `${text.substring(0, charLimit - 3)}...`;
    }

    /**
     * Escape HTML in the content
     *
     * @param content Content to escape HTML in
     */
    private escapeHtml(content: string) {
        const escapes: Record<string, string> = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#x27;',
            '/': '&#x2F;',
            '`': '&#x60;',
        };

        return (
            content
                // Split the content into parts before and after the member content
                // marker so that the marker itself does not get escaped
                .split(MEMBER_CONTENT_MARKER)
                .map((part) =>
                    part.replace(/[&<>"'`/]/g, (char) => escapes[char]),
                )
                .join(MEMBER_CONTENT_MARKER)
        );
    }

    /**
     * Convert line breaks to HTML
     *
     * @param content Content to convert line breaks to HTML
     */
    private convertLineBreaks(content: string) {
        return content
            .split(/\n/)
            .map((line) => line.trim())
            .join('<br />');
    }

    /**
     * Wrap the content in a paragraph
     *
     * @param content Content to wrap in a paragraph
     */
    private wrapInParagraph(content: string) {
        return `<p>${content}</p>`;
    }

    /**
     * Remove member content from the content
     *
     * @param content Content to remove member content from
     */
    private removeMemberContent(content: string) {
        const memberContentIdx = content.indexOf(MEMBER_CONTENT_MARKER);

        return content.substring(0, memberContentIdx);
    }
}
