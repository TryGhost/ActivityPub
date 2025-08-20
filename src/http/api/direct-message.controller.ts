import { randomUUID } from 'node:crypto';

import { Create, type Federation, Note } from '@fedify/fedify';
import { Temporal } from '@js-temporal/polyfill';

import type { AccountService } from '@/account/account.service';
import type { AppContext, ContextData } from '@/app';
import { parseURL } from '@/core/url';
import { BadRequest, NotFound } from '@/http/api/helpers/response';
import { RequireRoles, Route } from '@/http/decorators/route.decorator';
import { GhostRole } from '@/http/middleware/role-guard';
import { lookupActor } from '@/lookup-helpers';

/**
 * Controller for direct message operations
 */
export class DirectMessageController {
    constructor(
        private readonly accountService: AccountService,
        private readonly fedify: Federation<ContextData>,
    ) {}

    /**
     * Send a direct message to another ActivityPub actor
     */
    @Route('POST', '/.ghost/activitypub/v1/actions/send-dm')
    @RequireRoles(
        GhostRole.Owner,
        GhostRole.Administrator,
        GhostRole.Editor,
        GhostRole.Author,
    )
    async handleSendDirectMessage(ctx: AppContext) {
        const account = ctx.get('account');
        const apCtx = this.fedify.createContext(ctx.req.raw as Request, {
            globaldb: ctx.get('globaldb'),
            logger: ctx.get('logger'),
        });

        // Parse request body
        const body = await ctx.req.json().catch(() => null);
        if (!body) {
            return BadRequest('Invalid JSON body');
        }

        const { recipient, content } = body;

        if (!recipient || typeof recipient !== 'string') {
            return BadRequest('recipient is required and must be a string');
        }

        if (!content || typeof content !== 'string') {
            return BadRequest('content is required and must be a string');
        }

        if (content.length === 0 || content.length > 5000) {
            return BadRequest('content must be between 1 and 5000 characters');
        }

        // Parse recipient URL
        const recipientUrl = parseURL(recipient);
        if (!recipientUrl) {
            return BadRequest('recipient must be a valid URL');
        }

        try {
            // Get the sender's actor
            const actor = await apCtx.getActor(account.username);
            if (!actor) {
                return BadRequest('Unable to get actor for current account');
            }

            // Look up the recipient actor
            const recipientActor = await lookupActor(apCtx, recipientUrl.href);
            if (!recipientActor) {
                return NotFound('Recipient actor could not be found');
            }

            // Generate unique IDs for the activity and note
            const noteId = apCtx.getObjectUri(Note, { id: randomUUID() });
            const createId = apCtx.getObjectUri(Create, { id: randomUUID() });

            // Create the Note object for the DM
            const note = new Note({
                id: noteId,
                attribution: actor,
                content: content,
                published: Temporal.Now.instant(),
                to: recipientUrl, // Send directly to the recipient (this makes it a DM)
                // No 'cc' field and no PUBLIC_COLLECTION - this keeps it private
            });

            // Create the Create activity
            const create = new Create({
                id: createId,
                actor: actor,
                object: note,
                to: recipientUrl, // Same recipient as the note
            });

            // Store the activity and note in the global database
            const activityJson = await create.toJsonLd();
            const noteJson = await note.toJsonLd();

            await ctx.get('globaldb').set([create.id!.href], activityJson);
            await ctx.get('globaldb').set([note.id!.href], noteJson);

            // Send the activity to the recipient
            await apCtx.sendActivity(
                { username: account.username },
                recipientActor,
                create,
                {
                    preferSharedInbox: false, // Use personal inbox for DMs
                },
            );

            return new Response(
                JSON.stringify({
                    success: true,
                    message: 'Direct message sent successfully',
                    activityId: create.id!.href,
                    noteId: note.id!.href,
                }),
                {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/json',
                    },
                },
            );
        } catch (error) {
            console.error('Error sending direct message:', error);
            return new Response(
                JSON.stringify({
                    success: false,
                    error: 'Failed to send direct message',
                }),
                {
                    status: 500,
                    headers: {
                        'Content-Type': 'application/json',
                    },
                },
            );
        }
    }
}
