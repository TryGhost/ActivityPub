import { isActor } from '@fedify/fedify';
import { Context } from 'hono';
import sanitizeHtml from 'sanitize-html';

import {
    type HonoContextVariables,
    fedify
} from '../../app';

interface ProfileSearchResult {
    actor: any;
    handle: string;
    followerCount: number;
    isFollowing: boolean;
}

interface SearchResults {
    profiles: ProfileSearchResult[];
}

// @<username>@<domain>.<tld>
const HANDLE_REGEX = /^@([\w-]+)@([\w-]+\.[\w.-]+)$/;

// http(s)://...
const URI_REGEX = /^https?:\/\/[^\s/$.?#].[^\s]*$/;

export async function searchAction(
    ctx: Context<{ Variables: HonoContextVariables }>,
) {
    const db = ctx.get('db');
    const apCtx = fedify.createContext(ctx.req.raw as Request, {
        db,
        globaldb: ctx.get('globaldb'),
    });

    // Parse "query" from query parameters
    // ?query=<string>
    const query = ctx.req.query('query') || '';

    // Init search results - At the moment we only support searching for an actor (ui calls them profiles)
    const results: SearchResults = {
        profiles: [],
    };

    // If the query is not a handle or URI, return early
    if (HANDLE_REGEX.test(query) === false && URI_REGEX.test(query) === false) {
        console.log(`Invalid query: ${query}`);

        return new Response(JSON.stringify(results), {
            headers: {
                'Content-Type': 'application/json',
            },
            status: 200,
        });
    }

    // Lookup actor by handle or url
    try {
        const actor = await apCtx.lookupObject(query);

        if (actor && isActor(actor)) {
            const result: ProfileSearchResult = {
                actor: {},
                handle: '',
                followerCount: 0,
                isFollowing: false,
            };

            // Retrieve actor data
            result.actor = await actor.toJsonLd();

            // Sanitize actor data
            const sanitizeHtmlConfig = {
                allowedTags: ['a', 'p', 'img', 'br', 'strong', 'em', 'span'],
                allowedAttributes: {
                    a: ['href'],
                    img: ['src'],
                }
            };

            result.actor.summary = sanitizeHtml(result.actor.summary, sanitizeHtmlConfig);

            if (result.actor.attachment) {
                result.actor.attachment = result.actor.attachment.map((attachment: any) => {
                    if (attachment.type === 'PropertyValue') {
                        attachment.value = sanitizeHtml(attachment.value, sanitizeHtmlConfig);
                    }

                    return attachment;
                });
            }

            // Compute the full handle for the actor
            result.handle = `@${actor.preferredUsername}@${actor.id!.host}`;

            // Retrieve follower count for the actor
            result.followerCount = (await actor.getFollowers() || { totalItems: 0 })
                .totalItems || 0;

            // Determine if the current user is following the actor
            const following = (await db.get<string[]>(['following'])) || [];

            result.isFollowing = following.includes(actor.id!.href);

            // Add to the results
            results.profiles.push(result);
        }
    } catch (err) {
        console.log(`Profile search failed: ${query}`, err);
    }

    // Return results
    return new Response(JSON.stringify(results), {
        headers: {
            'Content-Type': 'application/json',
        },
        status: 200,
    });
}
