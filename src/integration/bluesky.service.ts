import { Create, Follow, Note, Undo } from '@fedify/vocab';
import type { Logger } from '@logtape/logtape';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import type { Account } from '@/account/account.entity';
import type { KnexAccountRepository } from '@/account/account.repository.knex';
import type { AccountService } from '@/account/account.service';
import type { FedifyContextFactory } from '@/activitypub/fedify-context.factory';
import {
    error,
    getError,
    getValue,
    isError,
    ok,
    type Result,
} from '@/core/result';
import type { AtprotoHandleResolver } from '@/integration/atproto-handle.resolver';
import { getDomainHandleCandidates } from '@/integration/bluesky.utils';
import type {
    BlueskyApiClient,
    BlueskyApiError,
} from '@/integration/bluesky-api.client';
import type { BridgyFedClient } from '@/integration/bridgy-fed.client';

/**
 * @see https://fed.brid.gy/docs
 */

export const BRIDGY_AP_ID = new URL('https://bsky.brid.gy/bsky.brid.gy');

/**
 * How long Bridgy Fed gets to switch the handle after we ask it to
 */
export const DOMAIN_HANDLE_CLAIM_TIMEOUT_MS = 10 * 60 * 1000;

const TABLE = 'bluesky_integration_account_handles';

/**
 * - `claiming`: we serve the DID for the domain and asked Bridgy Fed to
 *   switch the handle to it
 * - `active`: the Bluesky account uses the domain as its handle
 * - `unavailable`: the domain can't be used, see the reason
 * - `released`: the site moved to another domain, so it no longer serves the
 *   DID for this one
 */
export type DomainHandleStatus =
    | 'claiming'
    | 'active'
    | 'unavailable'
    | 'released';

/**
 * - `taken`: the domain already points at another atproto account
 * - `not_reachable`: the site doesn't serve /.well-known/atproto-did, usually
 *   because the proxy in front of it doesn't route it to this service
 * - `dns_error`: the domain's DNS couldn't be checked
 * - `rejected`: Bridgy Fed didn't switch the handle in time
 */
export type DomainHandleReason =
    | 'taken'
    | 'not_reachable'
    | 'dns_error'
    | 'rejected';

export interface DomainHandle {
    domain: string;
    status: DomainHandleStatus;
    reason: DomainHandleReason | null;
    /**
     * Whether the domain is being set up as part of enabling Bluesky sharing,
     * rather than because the publisher asked for it later
     */
    automatic: boolean;
}

export interface BlueskyIntegrationDetails {
    handleConfirmed: boolean;
    handle: string | null;
    domainHandle: DomainHandle | null;
}

type IntegrationNotEnabledError = { type: 'not-enabled' };
type HandleNotConfirmedError = { type: 'not-confirmed' };

interface IntegrationRow {
    account_id: number;
    handle: string | null;
    confirmed: boolean | number;
    did: string | null;
    domain_handle: string | null;
    domain_handle_status: DomainHandleStatus | null;
    domain_handle_reason: DomainHandleReason | null;
    domain_handle_claimed_at: Date | null;
    /**
     * Set when Bluesky sharing is enabled, so the domain is set up as part of
     * it. Accounts that enabled it before domain handles existed only switch
     * when the publisher asks, as their handle may be shared elsewhere
     */
    domain_handle_automatic: boolean | number;
}

type DomainHandleState = Pick<
    IntegrationRow,
    | 'domain_handle'
    | 'domain_handle_status'
    | 'domain_handle_reason'
    | 'domain_handle_claimed_at'
    | 'domain_handle_automatic'
>;

function domainHandleStateOf(row: DomainHandleState): DomainHandleState {
    return {
        domain_handle: row.domain_handle,
        domain_handle_status: row.domain_handle_status,
        domain_handle_reason: row.domain_handle_reason,
        domain_handle_claimed_at: row.domain_handle_claimed_at,
        domain_handle_automatic: row.domain_handle_automatic,
    };
}

export function toDomainHandle(row: {
    domain_handle: string | null;
    domain_handle_status: DomainHandleStatus | null;
    domain_handle_reason: DomainHandleReason | null;
    domain_handle_automatic: boolean | number;
}): DomainHandle | null {
    if (!row.domain_handle || !row.domain_handle_status) {
        return null;
    }

    return {
        domain: row.domain_handle,
        status: row.domain_handle_status,
        reason: row.domain_handle_reason,
        automatic: !!row.domain_handle_automatic,
    };
}

function toDetails(row: IntegrationRow): BlueskyIntegrationDetails {
    return {
        handleConfirmed: !!row.confirmed,
        handle: row.handle,
        domainHandle: toDomainHandle(row),
    };
}

export class BlueskyService {
    constructor(
        private readonly db: Knex,
        private readonly accountService: AccountService,
        private readonly accountRepository: KnexAccountRepository,
        private readonly fedifyContextFactory: FedifyContextFactory,
        private readonly logger: Logger,
        private readonly blueskyApiClient: BlueskyApiClient,
        private readonly bridgyFedClient: BridgyFedClient,
        private readonly atprotoHandleResolver: AtprotoHandleResolver,
    ) {}

    async enableForAccount(account: Account): Promise<
        {
            enabled: boolean;
        } & BlueskyIntegrationDetails
    > {
        const existing = await this.getRow(account);

        if (existing) {
            this.logger.info(
                `Bluesky integration already enabled for account {id}`,
                { id: account.id },
            );

            return {
                enabled: true,
                ...toDetails(existing),
            };
        }

        const bridgyAccount = await this.getBridgyAccount();

        // Send follow request to brid.gy account
        const ctx = this.fedifyContextFactory.getFedifyContext();

        const followId = ctx.getObjectUri(Follow, { id: uuidv4() });

        const follow = new Follow({
            id: followId,
            actor: account.apId,
            object: bridgyAccount.apId,
        });

        await ctx.data.globaldb.set([follow.id!.href], await follow.toJsonLd());

        await ctx.sendActivity(
            { username: account.username },
            {
                id: bridgyAccount.apId,
                inboxId: bridgyAccount.apInbox,
            },
            follow,
        );

        // Insert handle → account mapping into the database - handle is null
        // and confirmed is false until manual confirmation has occurred (see
        // `confirmHandleForAccount`), which also sets up the domain handle
        await this.db(TABLE)
            .insert({
                account_id: account.id,
                handle: null,
                confirmed: false,
                domain_handle_automatic: true,
            })
            .onConflict('account_id')
            .merge();

        return {
            enabled: true,
            handleConfirmed: false,
            handle: null,
            domainHandle: null,
        };
    }

    async disableForAccount(account: Account) {
        const existing = await this.getRow(account);

        if (!existing) {
            this.logger.info(
                `Bluesky integration already disabled for account {id}`,
                { id: account.id },
            );

            return;
        }

        const bridgyAccount = await this.getBridgyAccount();

        await this.sendBridgyDm(account, bridgyAccount, 'stop');

        // Unfollow brid.gy account
        await this.accountRepository.save(account.unfollow(bridgyAccount));

        const ctx = this.fedifyContextFactory.getFedifyContext();

        const follow = new Follow({
            id: null,
            actor: account.apId,
            object: bridgyAccount.apId,
        });

        const undoId = ctx.getObjectUri(Undo, { id: uuidv4() });

        const undo = new Undo({
            id: undoId,
            actor: account.apId,
            object: follow,
        });

        await ctx.data.globaldb.set([undo.id!.href], await undo.toJsonLd());

        await ctx.sendActivity(
            { username: account.username },
            {
                id: bridgyAccount.apId,
                inboxId: bridgyAccount.apInbox,
            },
            undo,
        );

        // Delete handle → account mapping from the database
        await this.db(TABLE).where('account_id', account.id).delete();
    }

    /**
     * Check what the bridged Bluesky account looks like now, and move the
     * domain handle forward: claim it if it hasn't been tried yet, and see
     * whether Bridgy Fed has switched to it after a claim
     *
     * Called repeatedly by the client while the integration is being set up
     */
    async confirmHandleForAccount(
        account: Account,
    ): Promise<
        Result<
            BlueskyIntegrationDetails,
            BlueskyApiError | IntegrationNotEnabledError
        >
    > {
        const existing = await this.getRow(account);

        if (!existing) {
            this.logger.debug(
                'Bluesky integration not enabled for account {id}',
                { id: account.id },
            );

            return error({ type: 'not-enabled' });
        }

        const settled =
            existing.confirmed &&
            existing.did &&
            existing.domain_handle_status !== 'claiming' &&
            !this.shouldSetUpDomainHandle(existing);

        if (settled) {
            this.logger.debug(
                'Bluesky handle already confirmed for account {id}',
                { id: account.id, handle: existing.handle },
            );

            return ok(toDetails(existing));
        }

        const refreshResult = await this.refreshHandle(account, existing);

        if (isError(refreshResult)) {
            return refreshResult;
        }

        const row = getValue(refreshResult);

        if (!row.confirmed || !row.did || !row.handle) {
            return ok(toDetails(row));
        }

        if (this.shouldSetUpDomainHandle(row)) {
            await this.claimDomainHandle(
                account,
                row.did,
                row.handle,
                row,
                true,
            );
        } else if (row.domain_handle_status === 'claiming') {
            await this.checkDomainHandleClaim(account, row);
        }

        return ok(toDetails((await this.getRow(account))!));
    }

    /**
     * Use the domain as the handle when the publisher asks for it, eg for an
     * account that enabled Bluesky sharing before domain handles existed, or
     * to try again after freeing up the domain
     */
    async useDomainHandleForAccount(
        account: Account,
    ): Promise<
        Result<
            BlueskyIntegrationDetails,
            | BlueskyApiError
            | IntegrationNotEnabledError
            | HandleNotConfirmedError
        >
    > {
        const existing = await this.getRow(account);

        if (!existing) {
            return error({ type: 'not-enabled' });
        }

        const refreshResult = await this.refreshHandle(account, existing);

        if (isError(refreshResult)) {
            return refreshResult;
        }

        const row = getValue(refreshResult);

        if (!row.confirmed || !row.did || !row.handle) {
            return error({ type: 'not-confirmed' });
        }

        await this.claimDomainHandle(account, row.did, row.handle, row, false);

        return ok(toDetails((await this.getRow(account))!));
    }

    /**
     * Get the DID to serve at /.well-known/atproto-did for the account, if it
     * claimed a domain handle
     *
     * Without `domain`, any domain the account claimed counts: lookups usually
     * arrive on the site's host after the handle's domain redirects there (eg
     * from `example.com` to `www.example.com`), and serving the DID for some
     * other domain that redirects to us is harmless - a handle is only valid
     * if the account's DID document claims it too. With `domain`, only a claim
     * for that domain counts
     */
    async getDomainHandleDid(
        account: Account,
        domain?: string,
    ): Promise<string | null> {
        const row = await this.getRow(account);

        if (
            !row?.did ||
            !row.domain_handle ||
            (row.domain_handle_status !== 'claiming' &&
                row.domain_handle_status !== 'active')
        ) {
            return null;
        }

        if (
            domain !== undefined &&
            row.domain_handle.toLowerCase() !== domain.toLowerCase()
        ) {
            return null;
        }

        return row.did;
    }

    /**
     * Whether confirming the handle should also set up the domain handle:
     * only when enabling Bluesky sharing, and only once
     */
    private shouldSetUpDomainHandle(row: IntegrationRow) {
        return (
            row.domain_handle_status === null && !!row.domain_handle_automatic
        );
    }

    /**
     * Find the bridged account's DID if we don't have it yet, and record its
     * current handle
     */
    private async refreshHandle(
        account: Account,
        row: IntegrationRow,
    ): Promise<Result<IntegrationRow, BlueskyApiError>> {
        let did = row.did;

        if (!did) {
            const didResult = await this.bridgyFedClient.getBridgedDid(
                account.apId,
            );

            if (isError(didResult)) {
                const err = getError(didResult);

                if (err.type === 'not-found') {
                    this.logger.info(
                        'Bluesky account not yet bridged for account {id}',
                        { id: account.id },
                    );

                    return ok(row);
                }

                this.logger.warn('Failed to get bridged DID for account {id}', {
                    id: account.id,
                    error: err,
                });

                return didResult;
            }

            did = getValue(didResult);

            await this.db(TABLE)
                .where('account_id', account.id)
                .update({ did });
        }

        const profileResult = await this.blueskyApiClient.getProfile(did);

        if (isError(profileResult)) {
            const err = getError(profileResult);

            if (err.type === 'not-found') {
                this.logger.info(
                    'Bluesky handle not yet available for account {id}',
                    { id: account.id, did },
                );

                return ok({ ...row, did });
            }

            this.logger.warn('Failed to get Bluesky profile for account {id}', {
                id: account.id,
                error: err,
            });

            return profileResult;
        }

        const { handle } = getValue(profileResult);

        if (handle === 'handle.invalid') {
            return ok({ ...row, did });
        }

        if (row.handle !== handle || !row.confirmed) {
            await this.db.transaction(async (trx) => {
                // A handle belongs to one account at a time, so any other row
                // still showing it is out of date (eg the account it moved from)
                await trx(TABLE)
                    .where('handle', handle)
                    .whereNot('account_id', account.id)
                    .update({ handle: null });

                await trx(TABLE)
                    .where('account_id', account.id)
                    .update({ handle, confirmed: true });
            });
        }

        return ok({ ...row, did, handle, confirmed: true });
    }

    /**
     * Point the first usable domain at the bridged account and ask Bridgy Fed
     * to use it as the handle
     *
     * A domain is only used when nothing else claims it: DNS takes precedence
     * over HTTPS in atproto handle resolution, so a domain that already points
     * at another account (eg the publisher's own Bluesky account) must be
     * left alone
     *
     * `expected` is the domain handle state the caller read. Nothing is
     * changed if it has changed since, eg because an overlapping confirmation
     * is claiming the domain, or the site moved to another domain
     *
     * `automatic` is whether this is part of enabling Bluesky sharing
     */
    private async claimDomainHandle(
        account: Account,
        did: string,
        currentHandle: string,
        expected: DomainHandleState,
        automatic: boolean,
    ) {
        const candidates = getDomainHandleCandidates(account);

        // The account already uses one of the domains, eg one set up by hand
        // or kept from before a domain change and back
        const inUse = candidates.find((domain) => domain === currentHandle);

        if (inUse) {
            await this.updateDomainHandleIf(account, expected, {
                domain_handle: inUse,
                domain_handle_status: 'active',
                domain_handle_reason: null,
                domain_handle_automatic: automatic,
            });

            return;
        }

        let failure: { domain: string; reason: DomainHandleReason } | null =
            null;

        for (const domain of candidates) {
            const outcome = await this.tryDomainHandle(
                account,
                did,
                domain,
                expected,
                automatic,
            );

            if (outcome === 'claimed' || outcome === 'superseded') {
                return;
            }

            // Report why the preferred domain can't be used
            failure ??= { domain, reason: outcome };
        }

        if (failure) {
            this.logger.info(
                'Domain handle {domain} unavailable for account {id}: {reason}',
                { id: account.id, ...failure },
            );

            await this.updateDomainHandleIf(account, expected, {
                domain_handle: failure.domain,
                domain_handle_status: 'unavailable',
                domain_handle_reason: failure.reason,
                domain_handle_automatic: automatic,
            });
        }
    }

    /**
     * Claim `domain` as the handle, or return why it can't be used
     *
     * Returns `superseded` if the domain handle state is no longer `expected`
     */
    private async tryDomainHandle(
        account: Account,
        did: string,
        domain: string,
        expected: DomainHandleState,
        automatic: boolean,
    ): Promise<DomainHandleReason | 'claimed' | 'superseded'> {
        const dnsResult = await this.atprotoHandleResolver.resolveDns(domain);

        if (isError(dnsResult)) {
            return 'dns_error';
        }

        const dnsDids = getValue(dnsResult);

        if (dnsDids.some((dnsDid) => dnsDid !== did)) {
            return 'taken';
        }

        // We don't serve the DID for this domain yet, so anything served
        // there comes from something else. It only matters without a DNS
        // record, which takes precedence
        if (dnsDids.length === 0) {
            const existingDid =
                await this.atprotoHandleResolver.resolveHttps(domain);

            if (existingDid !== null && existingDid !== did) {
                return 'taken';
            }
        }

        const claim: DomainHandleState = {
            domain_handle: domain,
            domain_handle_status: 'claiming',
            domain_handle_reason: null,
            domain_handle_claimed_at: new Date(),
            domain_handle_automatic: automatic,
        };

        if (!(await this.updateDomainHandleIf(account, expected, claim))) {
            return 'superseded';
        }

        const servedDid = await this.atprotoHandleResolver.resolveHttps(domain);

        // A DNS record for the account is enough on its own
        if (servedDid !== did && !dnsDids.includes(did)) {
            await this.updateDomainHandleIf(
                account,
                claim,
                domainHandleStateOf(expected),
            );

            return 'not_reachable';
        }

        try {
            await this.sendBridgyDm(
                account,
                await this.getBridgyAccount(),
                `username ${domain}`,
            );
        } catch (err) {
            // Leave it as it was, so the next check claims it again
            await this.updateDomainHandleIf(
                account,
                claim,
                domainHandleStateOf(expected),
            );

            throw err;
        }

        this.logger.info('Claimed domain handle {domain} for account {id}', {
            id: account.id,
            domain,
        });

        return 'claimed';
    }

    /**
     * See whether Bridgy Fed has switched to the domain handle we claimed
     */
    private async checkDomainHandleClaim(
        account: Account,
        row: IntegrationRow,
    ) {
        if (row.handle === row.domain_handle) {
            await this.updateDomainHandleIf(account, row, {
                domain_handle_status: 'active',
                domain_handle_reason: null,
            });

            return;
        }

        const claimedAt = row.domain_handle_claimed_at?.getTime() ?? 0;

        if (Date.now() - claimedAt > DOMAIN_HANDLE_CLAIM_TIMEOUT_MS) {
            this.logger.warn(
                'Bridgy Fed did not switch to domain handle {domain} for account {id}',
                { id: account.id, domain: row.domain_handle },
            );

            await this.updateDomainHandleIf(account, row, {
                domain_handle_status: 'unavailable',
                domain_handle_reason: 'rejected',
            });
        }
    }

    private async sendBridgyDm(
        account: Account,
        bridgyAccount: Account,
        content: string,
    ) {
        const ctx = this.fedifyContextFactory.getFedifyContext();

        const note = new Note({
            id: ctx.getObjectUri(Note, { id: uuidv4() }),
            attribution: account.apId,
            content,
            published: Temporal.Now.instant(),
            to: bridgyAccount.apId,
        });

        const create = new Create({
            id: ctx.getObjectUri(Create, { id: uuidv4() }),
            actor: account.apId,
            object: note,
            to: bridgyAccount.apId,
        });

        await ctx.data.globaldb.set([note.id!.href], await note.toJsonLd());
        await ctx.data.globaldb.set([create.id!.href], await create.toJsonLd());

        await ctx.sendActivity(
            { username: account.username },
            {
                id: bridgyAccount.apId,
                inboxId: bridgyAccount.apInbox,
            },
            create,
        );
    }

    private async getRow(account: Account): Promise<IntegrationRow | null> {
        return (
            (await this.db(TABLE).where('account_id', account.id).first()) ??
            null
        );
    }

    /**
     * Update the domain handle only if its status and claim time are still
     * the ones in `expected`
     *
     * @returns whether it was updated
     */
    private async updateDomainHandleIf(
        account: Account,
        expected: Pick<
            DomainHandleState,
            'domain_handle_status' | 'domain_handle_claimed_at'
        >,
        values: Partial<DomainHandleState>,
    ): Promise<boolean> {
        const query = this.db(TABLE).where('account_id', account.id);

        if (expected.domain_handle_status === null) {
            query.whereNull('domain_handle_status');
        } else {
            query.where('domain_handle_status', expected.domain_handle_status);
        }

        if (expected.domain_handle_claimed_at === null) {
            query.whereNull('domain_handle_claimed_at');
        } else {
            query.where(
                'domain_handle_claimed_at',
                expected.domain_handle_claimed_at,
            );
        }

        return (await query.update(values)) > 0;
    }

    private async getBridgyAccount() {
        const ensureBridgyAccountResult =
            await this.accountService.ensureByApId(BRIDGY_AP_ID);

        if (isError(ensureBridgyAccountResult)) {
            throw new Error('Failed to retrieve brid.gy account');
        }

        return getValue(ensureBridgyAccountResult);
    }
}
