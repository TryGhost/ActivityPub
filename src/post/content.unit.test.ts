import { AccountEntity } from 'account/account.entity';
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
            addMentions: false as const,
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

        describe('Adding mentions', () => {
            const account = AccountEntity.create({
                id: 1,
                uuid: 'test-uuid',
                username: 'user',
                name: 'Test User',
                bio: null,
                url: new URL('https://example.xyz/@user'),
                avatarUrl: null,
                bannerImageUrl: null,
                apId: new URL('https://example.xyz/@user'),
                apFollowers: null,
                apInbox: null,
                isInternal: false,
            });
            it('should convert mentions to hyperlinks', () => {
                const content = 'Hello @user@example.xyz, how are you?';
                const result = preparer.prepare(content, {
                    ...allOptionsDisabled,
                    addMentions: [
                        {
                            name: '@user@example.xyz',
                            href: new URL('https://example.xyz/@user'),
                            account: account,
                        },
                    ],
                });

                expect(result).toEqual(
                    'Hello <a href="https://example.xyz/@user" data-profile="@user@example.xyz" rel="nofollow noopener noreferrer">@user@example.xyz</a>, how are you?',
                );
            });

            it('should handle multiple mentions in the same content', () => {
                const content =
                    'Hello @user@example.xyz and @newUser@example.co.uk!';
                const result = preparer.prepare(content, {
                    ...allOptionsDisabled,
                    addMentions: [
                        {
                            name: '@user@example.xyz',
                            href: new URL('https://example.xyz/@user'),
                            account: account,
                        },
                        {
                            name: '@newUser@example.co.uk',
                            href: new URL('https://example.co.uk/@newUser'),
                            account: account,
                        },
                    ],
                });

                expect(result).toEqual(
                    'Hello <a href="https://example.xyz/@user" data-profile="@user@example.xyz" rel="nofollow noopener noreferrer">@user@example.xyz</a> and <a href="https://example.co.uk/@newUser" data-profile="@newUser@example.co.uk" rel="nofollow noopener noreferrer">@newUser@example.co.uk</a>!',
                );
            });

            it('should handle repeated mentions in the content', () => {
                const content =
                    'Hello @user@example.xyz, @user@example.xyz, and @user@example.xyz!';
                const result = preparer.prepare(content, {
                    ...allOptionsDisabled,
                    addMentions: [
                        {
                            name: '@user@example.xyz',
                            href: new URL('https://example.xyz/@user'),
                            account: account,
                        },
                    ],
                });

                expect(result).toEqual(
                    'Hello <a href="https://example.xyz/@user" data-profile="@user@example.xyz" rel="nofollow noopener noreferrer">@user@example.xyz</a>, <a href="https://example.xyz/@user" data-profile="@user@example.xyz" rel="nofollow noopener noreferrer">@user@example.xyz</a>, and <a href="https://example.xyz/@user" data-profile="@user@example.xyz" rel="nofollow noopener noreferrer">@user@example.xyz</a>!',
                );
            });

            it('should reject partially matching mentions', () => {
                const content = 'Hello @user@example.xyz and @user@exampleXxyz';
                const result = preparer.prepare(content, {
                    ...allOptionsDisabled,
                    addMentions: [
                        {
                            name: '@user@example.xyz',
                            href: new URL('https://example.xyz/@user'),
                            account: account,
                        },
                    ],
                });

                expect(result).toEqual(
                    'Hello <a href="https://example.xyz/@user" data-profile="@user@example.xyz" rel="nofollow noopener noreferrer">@user@example.xyz</a> and @user@exampleXxyz',
                );
            });

            it('should not modify content when no mentions are provided', () => {
                const content = 'Hello @user@example.xyz, how are you?';
                const result = preparer.prepare(content, {
                    ...allOptionsDisabled,
                    addMentions: [],
                });

                expect(result).toEqual(content);
            });

            it('should not modify content when addMentions is false', () => {
                const content = 'Hello @user@example.xyz, how are you?';
                const result = preparer.prepare(content, {
                    ...allOptionsDisabled,
                    addMentions: false,
                });

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

    describe('parseMentions', () => {
        it('should parse valid ActivityPub handles', () => {
            const content =
                'Hello @user@example.com and @another@domain.co.uk!';
            const result = ContentPreparer.parseMentions(content);

            expect(result).toEqual(
                new Set(['@user@example.com', '@another@domain.co.uk']),
            );
        });

        it('should return empty array when no mentions are found', () => {
            const content = 'Hello world! No mentions here.';
            const result = ContentPreparer.parseMentions(content);

            expect(result).toEqual(new Set([]));
        });

        it('should filter out invalid handles', () => {
            const content = 'Hello @invalid@ and @valid@example.com!';
            const result = ContentPreparer.parseMentions(content);

            expect(result).toEqual(new Set(['@valid@example.com']));
        });

        it('should handle multiple mentions in different formats', () => {
            const content =
                '@user1@domain.com Hello @user2@sub.domain.org! @invalid@ @user3@test.com';
            const result = ContentPreparer.parseMentions(content);

            expect(result).toEqual(
                new Set([
                    '@user1@domain.com',
                    '@user2@sub.domain.org',
                    '@user3@test.com',
                ]),
            );
        });

        it('should handle empty string', () => {
            const result = ContentPreparer.parseMentions('');

            expect(result).toEqual(new Set([]));
        });

        it('should filter out handles with surrounding punctuations', () => {
            const content =
                'Hello, @user@example.com! And (@another@domain.org) or "@another@test.com"';
            const result = ContentPreparer.parseMentions(content);

            expect(result).toEqual(
                new Set([
                    '@user@example.com',
                    '@another@domain.org',
                    '@another@test.com',
                ]),
            );
        });

        it('should filter out handles that match regex but fail isHandle validation', () => {
            const content = 'Hello @user@invalid-domain and @user@example.com';
            const result = ContentPreparer.parseMentions(content);

            expect(result).toEqual(new Set(['@user@example.com']));
        });

        it('should deduplicate repeated mentions', () => {
            const content =
                'Hello @user@example.com and @user@example.com and @user@example.com';
            const result = ContentPreparer.parseMentions(content);

            expect(result).toEqual(new Set(['@user@example.com']));
        });
    });
});
