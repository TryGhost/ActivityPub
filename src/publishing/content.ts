import { escapeHtml } from '../helpers/html';
import { htmlToText } from 'html-to-text';
/**
 * Marker to indicate that the proceeding content is member content
 */
export const MEMBER_CONTENT_MARKER = '<!--members-only-->';

/**
 * Options for preparing content
 */
interface PrepareContentOptions {
    /**
     * Whether to remove member content
     */
    removeMemberContent?: boolean;
    /**
     * Whether to escape HTML
     */
    escapeHtml?: boolean;
    /**
     * Whether to convert line breaks to HTML
     */
    convertLineBreaks?: boolean;
    /**
     * Whether to wrap in a paragraph
     */
    wrapInParagraph?: boolean;
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
        },
    ) {
        let prepared = content;

        if (options.removeMemberContent === true) {
            prepared = this.removeMemberContent(prepared);
        }

        if (options.escapeHtml === true) {
            prepared = this.escapeHtml(prepared);
        }

        if (options.convertLineBreaks === true) {
            prepared = this.convertLineBreaks(prepared);
        }

        if (options.wrapInParagraph === true) {
            prepared = this.wrapInParagraph(prepared);
        }

        return prepared;
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
        return (
            content
                // Split the content into parts before and after the member content
                // marker so that the marker itself does not get escaped
                .split(MEMBER_CONTENT_MARKER)
                .map((part) => escapeHtml(part))
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

        if (memberContentIdx !== -1) {
            return content.substring(0, memberContentIdx);
        }

        return content;
    }
}
