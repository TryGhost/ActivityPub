# Replace `account_delivery_backoffs` with Fedify's Circuit Breaker

## Status

Proposed — **alternative to [ADR-0014](0014-fedify-outbound-circuit-breaker.md)**

ADR-0014 and ADR-0015 are competing proposals; the team should adopt **one**.
ADR-0014 keeps `account_delivery_backoffs` and adds Fedify's circuit breaker
**on top** (additive). ADR-0015 (this one) **removes** `account_delivery_backoffs`
and makes Fedify's circuit breaker the **single** delivery-suppression
mechanism, to reduce the amount of bespoke code we maintain.

## Context

See ADR-0014 for the full description of our current delivery system. In short,
outbound delivery has three independent pieces:

1. **Retry engine** — GCP Pub/Sub main→retry-topic→backoff
   (`src/mq/gcloud-pubsub-push/mq.ts`).
2. **Error taxonomy** — `src/mq/gcloud-pubsub-push/error-utils.ts`.
3. **Per-destination suppression gate** — `account_delivery_backoffs`
   (`src/account/account.service.ts:1074`), our own hand-rolled circuit breaker:
   exponential `60s × 2ⁿ` window **per remote inbox**, recorded on permanent /
   non-retryable failures, enforced by dropping new sends at `_enqueue`, cleared
   on success.

This ADR concerns **only piece 3**. Pieces 1 and 2 are kept in both proposals.

The motivation for replacing is maintenance cost: `account_delivery_backoffs`
is a bespoke table + migration, three `AccountService` methods, and an
enqueue-time check that we own and test ourselves. Fedify 2.3.0 now ships a
maintained circuit breaker, so the appeal is "delete our version, use theirs."

### The structural fact that shapes this decision

Fedify's circuit breaker only opens on **transient host failures** (network /
transport errors and **5xx**, via `recordFailure`). Everything else —
**4xx, 429, and Fedify's "permanent" failures** — is routed through
`recordReachableFailure`, which is literally:

```ts
async recordReachableFailure(remoteHost) {
  return await this.recordSuccess(remoteHost);   // circuit-breaker.ts:327-331
}
```

i.e. a permanent rejection is treated as **the host being healthy**. The
configurable `failure` predicate (`CircuitBreakerOptions.failure`) is consulted
**only inside `recordFailure`** (the 5xx/transport path); 4xx never reach it.

**Consequence:** Fedify's circuit breaker *cannot be configured* to suppress a
destination that returns permanent 4xx (`404`, `410 Gone`, `403`, `422`, …) —
the exact case `account_delivery_backoffs` exists to handle. Making it do so
would require forking Fedify or intercepting before we hand the failure to it.

## Decision

Remove `account_delivery_backoffs` entirely and rely on Fedify's circuit breaker
as the sole per-destination/host suppression mechanism. Keep the retry engine,
error taxonomy, and `shouldDeliverActivity` internal-account filter.

Concretely:

- Delete `recordDeliveryFailure`, `clearDeliveryFailure`,
  `getActiveDeliveryBackoff`, the `account_delivery_backoffs` table + migration,
  the `handlePermanentFailure` → backoff wiring, and the `_enqueue` backoff drop.
- Enable Fedify's circuit breaker (`circuitBreaker: { … }`), after the same
  prerequisites as ADR-0014.
- **Explicitly accept** that permanently-dead destinations are no longer
  suppressed per-inbox (see "What we lose").

### Prerequisites

Same blockers as ADR-0014 — they do **not** go away by replacing:

- **P1 — queue must honour delayed re-enqueue** for circuit-held messages, or
  "hold" becomes a silent drop / busy-loop. (See ADR-0014 P1 for options.)
- **P2 — `cas` on the `KvStore`** or accept racy failure counting across Cloud
  Run instances.

### Migration plan (phased)

1. Implement P1 (held re-enqueue) and P2 decision, as in ADR-0014.
2. Enable the breaker in staging behind an env flag; verify open/hold/recover
   against a wiremock host returning 5xx / refusing connections.
3. **Stop writing** to `account_delivery_backoffs` (remove
   `recordDeliveryFailure` calls) while leaving reads in place; observe that
   transient backpressure is now handled by the breaker.
4. Remove the reads (`getActiveDeliveryBackoff` enqueue check) and the
   `AccountService` methods.
5. Drop the `account_delivery_backoffs` table in a follow-up migration once
   confident (keep it one release for rollback).
6. Remove the env flag and make the breaker the default.

## Consequences

### What we keep

- Retry engine (GCP), error taxonomy (`error-utils.ts`), and internal-account
  filtering (`shouldDeliverActivity`) — all unchanged, identical to ADR-0014.

### What we lose (the tradeoffs)

1. **Per-inbox suppression of permanently-dead destinations — removed, and
   not recoverable via configuration.** Because Fedify treats 4xx/410/permanent
   as success (see "structural fact" above), a follower whose inbox is
   `410 Gone` / `404` / `403` will be **re-attempted on every future activity**,
   indefinitely. Each attempt fails permanently and is abandoned for that
   message, but there is no memory across messages, so a popular local account
   fanning out to many dead followers pays a repeated, futile delivery cost —
   precisely the kind of waste ADR-0001 sought to avoid. Today
   `account_delivery_backoffs` dampens this after the first permanent failure.
   *Severity: grows with scale / account age (dead remote actors accumulate).*

2. **Granularity downgrade: per-host instead of per-inbox.** Even for the
   transient failures it does handle, the breaker gates a whole host. One broken
   actor on an otherwise-healthy shared host (e.g. a single expired-cert actor on
   a big instance) will not, on its own, cross the per-host `failureThreshold`,
   so it may **never** be suppressed — whereas `account_delivery_backoffs`
   suppresses that one inbox immediately. Conversely a flapping host gates all
   its inboxes together (usually fine, occasionally over-broad).

3. **DNS / SSL / `501` per-actor errors stop being suppressed promptly.** Today
   these are non-retryable → immediate per-inbox backoff. Under the breaker they
   count toward the per-host threshold (5 in 10 min) and otherwise keep being
   retried; a persistent single-actor TLS/DNS misconfiguration on a busy host may
   never trip a host-level circuit. Loss of fast, targeted suppression for these.

4. **Recovery semantics change for dead destinations.**
   `account_delivery_backoffs` backs off **exponentially without bound**
   (`60s, 120s, 240s, …`), so a truly-dead destination is probed less and less
   over time. The breaker uses a **fixed 30-min `recoveryDelay`** with half-open
   probing — excellent for transient outages, but for a destination that is
   permanently gone (if it were gated at all) it would re-probe **every 30 min
   forever**. The breaker is tuned for "temporarily down," not "gone."

5. **Still lossy unless P1 is done well, and racy unless P2 is** — identical to
   ADR-0014, but here there is no `account_delivery_backoffs` fallback if the
   breaker misbehaves.

### What we gain (over ADR-0014)

1. **Less bespoke code to own.** Delete a table + migration, three service
   methods, and the enqueue-time check; one suppression mechanism and one mental
   model instead of two.
2. **No overlap to reconcile.** ADR-0014 has a small double-trip on
   DNS/SSL/`501` (both mechanisms fire); removing ours eliminates that entirely.
3. Everything ADR-0014 gains over today (host-level transient backpressure,
   half-open recovery, `Retry-After`/429 correctness, per-host health
   observability) — see ADR-0014 "What we gain".

### Net trade

This proposal trades **per-inbox suppression of permanent/dead destinations**
(which the breaker structurally cannot replace) for **a smaller, single
codebase**. It is the right choice **only if** the team judges that repeated
futile delivery attempts to permanently-dead inboxes are acceptable (or better
addressed by a separate dead-follower-pruning mechanism), and that per-host
granularity is sufficient.

## How to choose between ADR-0014 and ADR-0015

Pick **ADR-0014 (keep both)** if:
- Suppressing delivery to permanently-dead / `410 Gone` inboxes matters at our
  scale, and per-inbox precision is valued.
- We want the safety of a fallback while bedding in the breaker.

Pick **ADR-0015 (replace)** if:
- Minimising maintained code outweighs the loss above.
- We plan to (or already) handle dead destinations another way — e.g. pruning
  stale follows / actors — making per-inbox permanent-failure suppression
  redundant.
- Per-host granularity is deemed sufficient.

A reasonable middle path (not a third ADR, just a note): adopt **ADR-0014 now**,
and revisit **ADR-0015** once a dead-follower-pruning mechanism exists, at which
point `account_delivery_backoffs` may become genuinely redundant and safe to
delete.

## Alternatives considered

- **Custom `failure` predicate to make the breaker open on 4xx.** Does not work:
  4xx are routed through `recordReachableFailure` and never reach the predicate.
  Would require forking/wrapping Fedify — more code than we delete. Rejected.
- **Replace per-inbox suppression with dead-follower pruning instead.** A better
  long-term answer to the permanent-destination problem, but it is a separate
  feature, not a circuit-breaker concern. Noted as the unblocker for this ADR.

## Open questions

- How many permanently-dead remote inboxes do we actually accumulate, and what
  is the measured cost of un-suppressed re-attempts? (Quantifies tradeoff #1.)
- Do we have, or want, a dead-follower / stale-actor pruning mechanism that would
  make per-inbox permanent suppression redundant?
- Same P1/P2 open questions as ADR-0014.
```
