import { htmlToText } from 'html-to-text';
import linkifyHtml from 'linkify-html';
import { find as findLinks } from 'linkifyjs';
import { parse } from 'node-html-parser';

import { HANDLE_REGEX } from '@/constants';
import { normalizePlainText } from '@/helpers/html';
import { isEqual } from '@/helpers/uri';
import {
    getHashtagUrl,
    type HashtagLink,
    normalizeHashtag,
} from '@/post/hashtag';
import {
    type Mention,
    PostContentWarning,
    PostSummary,
} from '@/post/post.entity';

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
 * Matches hashtags in plain text, which may have been HTML escaped.
 *
 * The `#` must be at the start of the text or follow a character that can't be
 * part of a word, URL path or HTML entity, so `/#anchor`, `page#anchor` and
 * `&#x27;` are not treated as hashtags. The lookbehind covers `/` and `&`
 * once they have been escaped.
 */
const HASHTAG_IN_TEXT_REGEX =
    /(^|[^\p{L}\p{M}\p{N}_&/#])(?<!&#x2F;|&amp;)#([\p{L}\p{M}\p{N}_]+)/gu;

/**
 * Matches anchors and other HTML tags so that hashtags are only linked in text
 * outside of existing links.
 */
const ANCHOR_OR_TAG_REGEX = /(<a\b[^>]*>[\s\S]*?<\/a>|<[^>]+>)/gi;

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
    /**
     * Whether to link hashtags in the content to the site's tag archives
     */
    addHashtags:
        | false
        | {
              siteUrl: URL;
          };
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
            addHashtags: false,
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
            addHashtags: false,
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

        if (options.addHashtags !== false) {
            prepared = this.addHashtags(prepared, options.addHashtags.siteUrl);
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
        const tokens = findLinks(content, 'url');

        let preparedContent = '';
        let lastEnd = 0;
        for (const token of tokens) {
            preparedContent += content.substring(lastEnd, token.start);
            preparedContent += `__URL_${urls.length}__`;
            urls.push(token.value);
            lastEnd = token.end;
        }
        preparedContent += content.substring(lastEnd);

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
            (_, index) => urls[Number.parseInt(index, 10)],
        );
    }

    /**
     * Link hashtags in the content to the site's tag archives, using the same
     * markup as Mastodon so that other Fediverse software recognises them.
     * Text inside existing links is left untouched.
     *
     * @param html HTML content to add hashtag links to
     * @param siteUrl URL of the site that owns the tag archives
     */
    private addHashtags(html: string, siteUrl: URL): string {
        return html
            .split(ANCHOR_OR_TAG_REGEX)
            .map((segment) => {
                if (segment.startsWith('<')) {
                    return segment;
                }

                return segment.replace(
                    HASHTAG_IN_TEXT_REGEX,
                    (match, prefix: string, name: string) => {
                        if (normalizeHashtag(name) === null) {
                            return match;
                        }

                        const href = getHashtagUrl(siteUrl, name);

                        return `${prefix}<a href="${href.href}" class="mention hashtag" rel="tag">#<span>${name}</span></a>`;
                    },
                );
            })
            .join('');
    }

    static parseHashtagLinks(html: string) {
        return ContentPreparer.instance.parseHashtagLinks(html);
    }

    /**
     * Get the hashtag links in the content, i.e. links with `rel="tag"` whose
     * text is a hashtag. Duplicate hashtags are only returned once.
     *
     * @param html HTML content to get hashtag links from
     */
    private parseHashtagLinks(html: string): HashtagLink[] {
        const hashtagLinks = new Map<string, HashtagLink>();

        for (const link of parse(html).querySelectorAll('a')) {
            const rel = link.getAttribute('rel')?.split(/\s+/) ?? [];
            const href = link.getAttribute('href');
            const text = link.textContent.trim();

            if (!rel.includes('tag') || !href || !text.startsWith('#')) {
                continue;
            }

            const name = text.slice(1);
            const normalized = normalizeHashtag(name);

            if (normalized === null || hashtagLinks.has(normalized)) {
                continue;
            }

            try {
                hashtagLinks.set(normalized, { name, href: new URL(href) });
            } catch {
                // Ignore links with invalid URLs
            }
        }

        return [...hashtagLinks.values()];
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

    static regenerateContentWarning(html: string) {
        return ContentPreparer.instance.regenerateContentWarning(html);
    }

    // Content warnings are short plain-text labels, so strip any HTML and
    // truncate to the maximum length.
    regenerateContentWarning(html: string): PostContentWarning {
        return PostContentWarning.parse(
            normalizePlainText(html).substring(0, 500),
        );
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
