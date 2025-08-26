import { htmlToText } from 'html-to-text';
import linkifyHtml from 'linkify-html';
import { parse } from 'node-html-parser';
import urlRegex from 'url-regex';

import { HANDLE_REGEX } from '@/constants';
import { isEqual } from '@/helpers/uri';
import { type Mention, PostSummary } from '@/post/post.entity';

/**
 * Marker to indicate that the proceeding content is member content
 */
export const MEMBER_CONTENT_MARKER = '<!--members-only-->';

/**
 * Paid content preview message added to non-public posts
 */
export const PAID_CONTENT_PREVIEW_HTML = (url: URL) =>
    `<div class="gh-paid-content-notice"><h3>This post is for subscribers only</h3><p>Become a member to get access to all content</p><a class="gh-paid-content-cta" href="${url.href}#/portal/signup">Subscribe now</a></div>`;

/**
 * Options for preparing content
 */
export interface PrepareContentOptions {
    /**
     * Whether to remove gated content
     */
    removeGatedContent: boolean;
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
    /**
     * Whether to add mentions to the content
     */
    addMentions: false | Mention[];
}

export class ContentPreparer {
    static instance = new ContentPreparer();

    static prepare(
        content: string,
        options: PrepareContentOptions = {
            removeGatedContent: false,
            removeMemberContent: false,
            escapeHtml: false,
            convertLineBreaks: false,
            wrapInParagraph: false,
            extractLinks: false,
            addPaidContentMessage: false,
            addMentions: false,
        },
    ) {
        return ContentPreparer.instance.prepare(content, options);
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
            removeGatedContent: false,
            removeMemberContent: false,
            escapeHtml: false,
            convertLineBreaks: false,
            wrapInParagraph: false,
            extractLinks: false,
            addPaidContentMessage: false,
            addMentions: false,
        },
    ) {
        let prepared = content;

        if (options.removeGatedContent === true) {
            prepared = this.removeGatedContent(prepared);
        }

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

        if (options.addMentions !== false && options.addMentions.length > 0) {
            prepared = this.addMentions(prepared, options.addMentions);
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

    private addMentions(content: string, mentions: Mention[]) {
        // Protect URLs by replacing them with placeholders
        const urls: string[] = [];
        let preparedContent = content.replace(urlRegex(), (url) => {
            urls.push(url);
            return `__URL_${urls.length - 1}__`;
        });

        for (const mention of mentions) {
            const mentionRegex = new RegExp(
                mention.name.replace(/\./g, '\\.'), // Escape the dot (.) character
                'g',
            );
            preparedContent = preparedContent.replace(
                mentionRegex,
                `<a href="${mention.href}" data-profile="${mention.name}" rel="nofollow noopener noreferrer">${mention.name}</a>`,
            );
        }

        // Restore URLs
        return preparedContent.replace(
            /__URL_(\d+)__/g,
            (_, index) => urls[Number.parseInt(index)],
        );
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

    static regenerateExcerpt(html: string) {
        return ContentPreparer.instance.regenerateExcerpt(html);
    }

    /**
     * Re-generate excerpt from HTML content, based on a character limit
     *
     * @param html HTML content to generate an excerpt from
     */
    regenerateExcerpt(html: string): PostSummary {
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

        if (text.length <= 500) {
            return PostSummary.parse(text);
        }

        return PostSummary.parse(`${text.substring(0, 500 - 3)}...`);
    }

    static parseMentions(content: string) {
        return ContentPreparer.instance.parseMentions(content);
    }

    private parseMentions(content: string): Set<string> {
        const mentions =
            content.match(new RegExp(HANDLE_REGEX.source, 'g')) || [];
        return new Set(mentions);
    }

    static updateMentions(content: string, mentions: Mention[]) {
        return ContentPreparer.instance.updateMentions(content, mentions);
    }

    /**
     * Updates existing hyperlinks with data-profile attribute and rel attributes
     */
    private updateMentions(content: string, mentions: Mention[]) {
        try {
            const html = parse(content);
            const links = html.querySelectorAll('a');

            for (const mention of mentions) {
                // Find all links that matches the mentioned account
                for (const link of links) {
                    const href = link.getAttribute('href');
                    if (
                        href &&
                        (isEqual(mention.account.apId, href) ||
                            isEqual(mention.account.url, href))
                    ) {
                        // Update the link attributes
                        link.setAttribute(
                            'data-profile',
                            `@${mention.account.username}@${mention.account.apId.hostname}`,
                        );
                        link.setAttribute(
                            'rel',
                            'nofollow noopener noreferrer',
                        );
                    }
                }
            }

            return html.toString();
        } catch (_error) {
            // If anything goes wrong during parsing or processing, return the original content
            return content;
        }
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

    /**
     * Remove gated content that is visible to members only, as well as gated content markers
     *
     * @param content Content to remove gated content from
     * @returns {string} Content without gated content
     */
    private removeGatedContent(content: string) {
        let result = content;

        // Remove members-only content and markers
        const membersOnlyContentRegex =
            /<!--kg-gated-block:begin\s+nonMember:false[^>]*?-->([\s\S]*?)<!--kg-gated-block:end-->/g;
        result = result.replace(membersOnlyContentRegex, '');

        // Remove markers for public content but keep the content
        const publicContentRegex =
            /<!--kg-gated-block:begin\s+nonMember:true[^>]*?-->([\s\S]*?)<!--kg-gated-block:end-->/g;
        result = result.replace(publicContentRegex, '$1');

        return result;
    }
}
