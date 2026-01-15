import { beforeEach, describe, expect, it } from 'vitest';

import type { AccountEntity } from '@/account/account.entity';
import {
    ContentPreparer,
    MEMBER_CONTENT_MARKER,
    PAID_CONTENT_PREVIEW_HTML,
} from '@/post/content';
import { createTestExternalAccount } from '@/test/account-entity-test-helpers';

describe('ContentPreparer', () => {
    const preparer = new ContentPreparer();

    describe('prepare', () => {
        const allOptionsDisabled = {
            removeGatedContent: false,
            removeMemberContent: false,
            escapeHtml: false,
            convertLineBreaks: false,
            wrapInParagraph: false,
            extractLinks: false,
            addPaidContentMessage: false as const,
            addMentions: false as const,
        };

        describe('Removing gated content', () => {
            it('removes content that is visible to members only', () => {
                const content =
                    'Hello, world!<!--kg-gated-block:begin nonMember:false memberSegment:"status:free" --> This is visible to free members only!<!--kg-gated-block:end--> Bye!';
                const result = preparer.prepare(content, {
                    ...allOptionsDisabled,
                    removeGatedContent: true,
                });

                expect(result).toEqual('Hello, world! Bye!');
            });

            it('removes content that is visible to paid members only', () => {
                const content =
                    'Hello, world!<!--kg-gated-block:begin nonMember:false memberSegment:"status:-free" --> This is visible to paid members only!<!--kg-gated-block:end--> Bye!';
                const result = preparer.prepare(content, {
                    ...allOptionsDisabled,
                    removeGatedContent: true,
                });

                expect(result).toEqual('Hello, world! Bye!');
            });

            it('keeps content that is visible publicly but removes markers', () => {
                const content =
                    'Hello, world!<!--kg-gated-block:begin nonMember:true memberSegment:"" --> This is visible publicly!<!--kg-gated-block:end--> Bye!';
                const result = preparer.prepare(content, {
                    ...allOptionsDisabled,
                    removeGatedContent: true,
                });

                expect(result).toEqual(
                    'Hello, world! This is visible publicly! Bye!',
                );
            });

            it('keeps content that is visible to both public visitors and free members', () => {
                const content =
                    'Hello, world!<!--kg-gated-block:begin nonMember:true memberSegment:"status:free" --> This is visible publicly and to free members!<!--kg-gated-block:end--> Bye!';
                const result = preparer.prepare(content, {
                    ...allOptionsDisabled,
                    removeGatedContent: true,
                });

                expect(result).toEqual(
                    'Hello, world! This is visible publicly and to free members! Bye!',
                );
            });

            it('keeps content that is visible to both public visitors and paid members', () => {
                const content =
                    'Hello, world!<!--kg-gated-block:begin nonMember:true memberSegment:"-status:free" --> This is visible publicly and to paid members!<!--kg-gated-block:end--> Bye!';
                const result = preparer.prepare(content, {
                    ...allOptionsDisabled,
                    removeGatedContent: true,
                });

                expect(result).toEqual(
                    'Hello, world! This is visible publicly and to paid members! Bye!',
                );
            });

            it('can handle multiple gated blocks', () => {
                const content =
                    'Hello, world!<!--kg-gated-block:begin nonMember:false memberSegment:"status:free" --> This is visible to free members only!<!--kg-gated-block:end--> How are you?<!--kg-gated-block:begin nonMember:true memberSegment:"" --> This is visible publicly!<!--kg-gated-block:end--> Good, and you?<!--kg-gated-block:begin nonMember:true memberSegment:"status:free" --> This is visible publicly and to free members!<!--kg-gated-block:end--> Bye!';
                const result = preparer.prepare(content, {
                    ...allOptionsDisabled,
                    removeGatedContent: true,
                });

                expect(result).toEqual(
                    'Hello, world! How are you? This is visible publicly! Good, and you? This is visible publicly and to free members! Bye!',
                );
            });
        });

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
            let account: AccountEntity;

            beforeEach(async () => {
                account = await createTestExternalAccount(1, {
                    username: 'user',
                    name: 'Test User',
                    bio: null,
                    url: new URL('https://example.xyz/@user'),
                    avatarUrl: null,
                    bannerImageUrl: null,
                    customFields: null,
                    apId: new URL('https://example.xyz/@user'),
                    apFollowers: null,
                    apInbox: null,
                });
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

            it('should not convert mentions to hyperlinks if they are part of a link', () => {
                const content =
                    'Hello @user@example.xyz and https://example.xyz/@user@example.xyz';
                const result = preparer.prepare(content, {
                    ...allOptionsDisabled,
                    extractLinks: true,
                    addMentions: [
                        {
                            name: '@user@example.xyz',
                            href: new URL('https://example.xyz/@user'),
                            account: account,
                        },
                    ],
                });

                expect(result).toEqual(
                    'Hello <a href="https://example.xyz/@user" data-profile="@user@example.xyz" rel="nofollow noopener noreferrer">@user@example.xyz</a> and <a href="https://example.xyz/@user@example.xyz">https://example.xyz/@user@example.xyz</a>',
                );
            });

            it('should not convert mentions to hyperlinks if they are part of a URL in HTML content', () => {
                const content =
                    '<p>Hello @user@example.xyz and https://example.xyz/@user@example.xyz</p>';
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
                    '<p>Hello <a href="https://example.xyz/@user" data-profile="@user@example.xyz" rel="nofollow noopener noreferrer">@user@example.xyz</a> and https://example.xyz/@user@example.xyz</p>',
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
            const result = preparer.regenerateExcerpt(content);

            expect(result).toEqual('Hello, world!');
        });

        it('truncates the content if longer than the limit', () => {
            const content =
                '<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium.</p>';
            const result = preparer.regenerateExcerpt(content);

            expect(result).toEqual(
                'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. Sed ut perspiciatis unde omnis iste natus error sit...',
            );
            expect(result.length).toEqual(500);
        });

        it('should ignore <img> tags', () => {
            const content =
                '<img src="https://example.com/image.jpg" /><p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium.</p>';
            const result = preparer.regenerateExcerpt(content);

            expect(result).toEqual(
                'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. Sed ut perspiciatis unde omnis iste natus error sit...',
            );
            expect(result.length).toEqual(500);
        });

        it('should remove <a> href attributes', () => {
            const content =
                '<a href="https://example.com/image.jpg" />Link.</a><p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium.</p>';
            const result = preparer.regenerateExcerpt(content);

            expect(result).toEqual(
                'Link.\n\nLorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. Sed ut perspiciatis unde omnis iste natus er...',
            );
            expect(result.length).toEqual(500);
        });

        it('should ignore <figcaption> tags', () => {
            const content =
                '<figcaption>This is a caption</figcaption><p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium.</p>';
            const result = preparer.regenerateExcerpt(content);

            expect(result).toEqual(
                'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. Sed ut perspiciatis unde omnis iste natus error sit...',
            );
            expect(result.length).toEqual(500);
        });

        it('should ignore <hr> tags', () => {
            const content =
                '<hr /><p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium.</p>';
            const result = preparer.regenerateExcerpt(content);

            expect(result).toEqual(
                'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. Sed ut perspiciatis unde omnis iste natus error sit...',
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

    describe('updateMentions', () => {
        let account: AccountEntity;
        let account2: AccountEntity;

        beforeEach(async () => {
            account = await createTestExternalAccount(1, {
                username: 'user',
                name: 'Test User',
                bio: null,
                url: new URL('https://example.xyz/@user'),
                avatarUrl: null,
                bannerImageUrl: null,
                customFields: null,
                apId: new URL('https://example.xyz/user/@user'),
                apFollowers: null,
                apInbox: null,
            });

            account2 = await createTestExternalAccount(2, {
                username: 'user2',
                name: 'Test User 2',
                bio: null,
                url: new URL('https://example.xyz/@user2/'),
                avatarUrl: null,
                bannerImageUrl: null,
                customFields: null,
                apId: new URL('https://example.xyz/user/@user2/'),
                apFollowers: null,
                apInbox: null,
            });
        });

        it('should add data-profile and rel to links matching account.apId', () => {
            const content =
                '<p>Hey there! <span class="h-card"><a href="https://example.xyz/user/@user">@user@example.xyz</a></span> How are you?</p>';
            const result = ContentPreparer.updateMentions(content, [
                {
                    name: '@user@example.xyz',
                    href: new URL('https://example.xyz/user/@user'),
                    account: account,
                },
            ]);

            expect(result).toEqual(
                '<p>Hey there! <span class="h-card"><a href="https://example.xyz/user/@user" data-profile="@user@example.xyz" rel="nofollow noopener noreferrer">@user@example.xyz</a></span> How are you?</p>',
            );
        });

        it('should add data-profile and rel to links matching account.url', () => {
            const content =
                '<p>Check out <span class="mention"><a href="https://example.xyz/@user">@user@example.xyz</a></span> profile!</p>';
            const result = ContentPreparer.updateMentions(content, [
                {
                    name: '@user@example.xyz',
                    href: new URL('https://example.xyz/user/@user'),
                    account: account,
                },
            ]);

            expect(result).toEqual(
                '<p>Check out <span class="mention"><a href="https://example.xyz/@user" data-profile="@user@example.xyz" rel="nofollow noopener noreferrer">@user@example.xyz</a></span> profile!</p>',
            );
        });

        it('should add data-profile and rel to mentions that are not complete handles', () => {
            const content =
                '<p>Check out <span class="mention"><a href="https://example.xyz/@user">@user</a></span> profile!</p>';
            const result = ContentPreparer.updateMentions(content, [
                {
                    name: '@user@example.xyz',
                    href: new URL('https://example.xyz/user/@user'),
                    account: account,
                },
            ]);

            expect(result).toEqual(
                '<p>Check out <span class="mention"><a href="https://example.xyz/@user" data-profile="@user@example.xyz" rel="nofollow noopener noreferrer">@user</a></span> profile!</p>',
            );
        });

        it('should add data-profile and rel to links with no rel attribute', () => {
            const content =
                '<p>Welcome <span class="h-card"><a href="https://example.xyz/@user" class="mention">@user@example.xyz</a></span> to our platform!</p>';
            const result = ContentPreparer.updateMentions(content, [
                {
                    name: '@user@example.xyz',
                    href: new URL('https://example.xyz/user/@user'),
                    account: account,
                },
            ]);

            expect(result).toEqual(
                '<p>Welcome <span class="h-card"><a href="https://example.xyz/@user" class="mention" data-profile="@user@example.xyz" rel="nofollow noopener noreferrer">@user@example.xyz</a></span> to our platform!</p>',
            );
        });

        it('should replace any existing rel with rel="nofollow noopener noreferrer"', () => {
            const content =
                '<p>Hello <span class="h-card"><a href="https://example.xyz/@user" rel="nofollow">@user@example.xyz</a></span> nice to meet you!</p>';
            const result = ContentPreparer.updateMentions(content, [
                {
                    name: '@user@example.xyz',
                    href: new URL('https://example.xyz/user/@user'),
                    account: account,
                },
            ]);

            expect(result).toEqual(
                '<p>Hello <span class="h-card"><a href="https://example.xyz/@user" rel="nofollow noopener noreferrer" data-profile="@user@example.xyz">@user@example.xyz</a></span> nice to meet you!</p>',
            );
        });

        it('should handle multiple links in the same content', () => {
            const content =
                '<p>Check out <span class="h-card"><a href="https://example.xyz/@user">@user@example.xyz</a></span>, <span class="h-card"><a href="https://example.xyz/@user">@user@example.xyz</a></span> and <span class="h-card"><a href="https://example.xyz/@user2">@user2@example.xyz</a></span> profiles!</p>';
            const result = ContentPreparer.updateMentions(content, [
                {
                    name: '@user@example.xyz',
                    href: new URL('https://example.xyz/user/@user'),
                    account: account,
                },
                {
                    name: '@user2@example.xyz',
                    href: new URL('https://example.xyz/user/@user2'),
                    account: account2,
                },
            ]);

            expect(result).toEqual(
                '<p>Check out <span class="h-card"><a href="https://example.xyz/@user" data-profile="@user@example.xyz" rel="nofollow noopener noreferrer">@user@example.xyz</a></span>, <span class="h-card"><a href="https://example.xyz/@user" data-profile="@user@example.xyz" rel="nofollow noopener noreferrer">@user@example.xyz</a></span> and <span class="h-card"><a href="https://example.xyz/@user2" data-profile="@user2@example.xyz" rel="nofollow noopener noreferrer">@user2@example.xyz</a></span> profiles!</p>',
            );
        });

        it('should handle links with different quote types', () => {
            const content =
                '<p>Welcome <span class="h-card"><a href=\'https://example.xyz/@user\'>@user@example.xyz</a></span> to our community!</p>';
            const result = ContentPreparer.updateMentions(content, [
                {
                    name: '@user@example.xyz',
                    href: new URL('https://example.xyz/user/@user'),
                    account: account,
                },
            ]);

            expect(result).toEqual(
                '<p>Welcome <span class="h-card"><a href="https://example.xyz/@user" data-profile="@user@example.xyz" rel="nofollow noopener noreferrer">@user@example.xyz</a></span> to our community!</p>',
            );
        });

        it('should handle empty link content', () => {
            const content =
                '<p>Hey <a href="https://example.xyz/@user"></a>, how are you?</p>';
            const result = ContentPreparer.updateMentions(content, [
                {
                    name: '@user@example.xyz',
                    href: new URL('https://example.xyz/user/@user'),
                    account: account,
                },
            ]);

            expect(result).toBe(
                '<p>Hey <a href="https://example.xyz/@user" data-profile="@user@example.xyz" rel="nofollow noopener noreferrer"></a>, how are you?</p>',
            );
        });

        it('should handle links with existing data-profile', () => {
            const content =
                '<p>Hello <span class="h-card"><a href="https://example.xyz/@user" data-profile="@user@example.xyz">@user@example.xyz</a></span> welcome back!</p>';
            const result = ContentPreparer.updateMentions(content, [
                {
                    name: '@user@example.xyz',
                    href: new URL('https://example.xyz/user/@user'),
                    account: account,
                },
            ]);

            expect(result).toEqual(
                '<p>Hello <span class="h-card"><a href="https://example.xyz/@user" data-profile="@user@example.xyz" rel="nofollow noopener noreferrer">@user@example.xyz</a></span> welcome back!</p>',
            );
        });

        it('should not modify non-matching links', () => {
            const content =
                '<p>Check out <span class="h-card"><a href="https://other-domain.com/@user">@user@other-domain.com</a></span> and <span class="h-card"><a href="https://example.xyz/@user">@user@example.xyz</a></span> profiles!</p>';
            const result = ContentPreparer.updateMentions(content, [
                {
                    name: '@user@example.xyz',
                    href: new URL('https://example.xyz/user/@user'),
                    account: account,
                },
            ]);

            expect(result).toEqual(
                '<p>Check out <span class="h-card"><a href="https://other-domain.com/@user">@user@other-domain.com</a></span> and <span class="h-card"><a href="https://example.xyz/@user" data-profile="@user@example.xyz" rel="nofollow noopener noreferrer">@user@example.xyz</a></span> profiles!</p>',
            );
        });

        it('should handle links with nested spans in their content', () => {
            const content =
                '<p>Hello check <span class="h-card" translate="no"><a href="https://example.xyz/@user" class="u-url mention">@<span>user</span></a></span> <span class="h-card" translate="no"><a href="https://other-domain.com/" class="u-url mention">@<span>other</span></a></span></p>';
            const result = ContentPreparer.updateMentions(content, [
                {
                    name: '@user@example.xyz',
                    href: new URL('https://example.xyz/@user'),
                    account: account,
                },
            ]);

            expect(result).toEqual(
                '<p>Hello check <span class="h-card" translate="no"><a href="https://example.xyz/@user" class="u-url mention" data-profile="@user@example.xyz" rel="nofollow noopener noreferrer">@<span>user</span></a></span> <span class="h-card" translate="no"><a href="https://other-domain.com/" class="u-url mention">@<span>other</span></a></span></p>',
            );
        });

        it('should handle links with complex nested HTML structure', () => {
            const content =
                '<p>Check out <span class="h-card"><a href="https://example.xyz/@user" class="mention">@<span class="username"><strong>user</strong><em>@example.xyz</em></span><img src="avatar.jpg" alt="avatar" ></a></span> profile!</p>';
            const result = ContentPreparer.updateMentions(content, [
                {
                    name: '@user@example.xyz',
                    href: new URL('https://example.xyz/@user'),
                    account: account,
                },
            ]);

            expect(result).toEqual(
                '<p>Check out <span class="h-card"><a href="https://example.xyz/@user" class="mention" data-profile="@user@example.xyz" rel="nofollow noopener noreferrer">@<span class="username"><strong>user</strong><em>@example.xyz</em></span><img src="avatar.jpg" alt="avatar" ></a></span> profile!</p>',
            );
        });

        it('should handle URLs with trailing slashes', () => {
            const content =
                '<p>Check out <span class="h-card"><a href="https://example.xyz/@user/">@user@example.xyz</a></span> profile!</p>';
            const result = ContentPreparer.updateMentions(content, [
                {
                    name: '@user@example.xyz',
                    href: new URL('https://example.xyz/@user'),
                    account: account,
                },
            ]);

            expect(result).toEqual(
                '<p>Check out <span class="h-card"><a href="https://example.xyz/@user/" data-profile="@user@example.xyz" rel="nofollow noopener noreferrer">@user@example.xyz</a></span> profile!</p>',
            );
        });

        it('should handle href attribute in any position within the tag', () => {
            const content =
                '<p>Check out <span class="h-card"><a class="mention" href="https://example.xyz/@user" data-other="value">@<span>user</span></a></span> profile!</p>';
            const result = ContentPreparer.updateMentions(content, [
                {
                    name: '@user@example.xyz',
                    href: new URL('https://example.xyz/@user'),
                    account: account,
                },
            ]);

            expect(result).toEqual(
                '<p>Check out <span class="h-card"><a class="mention" href="https://example.xyz/@user" data-other="value" data-profile="@user@example.xyz" rel="nofollow noopener noreferrer">@<span>user</span></a></span> profile!</p>',
            );
        });

        it('should not do anything if the content is not valid HTML', () => {
            const content = 'This is plain text with @user@example.xyz mention';
            const result = ContentPreparer.updateMentions(content, [
                {
                    name: '@user@example.xyz',
                    href: new URL('https://example.xyz/@user'),
                    account: account,
                },
            ]);

            expect(result).toEqual(content);
        });

        it('should not do anything if the mention is not wrapped in hyperlink', () => {
            const content = '<p>Check out @user@example.xyz profile!</p>';
            const result = ContentPreparer.updateMentions(content, [
                {
                    name: '@user@example.xyz',
                    href: new URL('https://example.xyz/@user'),
                    account: account,
                },
            ]);

            expect(result).toEqual(content);
        });
    });
});
