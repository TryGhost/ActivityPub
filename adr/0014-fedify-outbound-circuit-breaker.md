# Adopt Fedify's Outbound Delivery Circuit Breaker

## Status

Proposed — **alternative to [ADR-0015](0015-replace-account-delivery-backoff-with-circuit-breaker.md)**

ADR-0014 and ADR-0015 are competing proposals; the team should adopt **one**.
ADR-0014 (this one) keeps `account_delivery_backoffs` and adds Fedify's circuit
breaker **on top** (additive). ADR-0015 **removes** `account_delivery_backoffs`
and makes the circuit breaker the **single** suppression mechanism. See
ADR-0015's "How to choose" section for the decision guide.

## Context

Fedify 2.3.0 added an **outbound delivery circuit breaker** that is enabled by
default whenever an outbox queue is configured. We currently **disable** it
(`circuitBreaker: false` in `src/configuration/registrations.ts`) because, as
shipped, it silently drops deliveries on our queue (see "Why it is disabled
today" below). This ADR proposes how we could adopt it deliberately, **without
losing any current functionality**, and documents what we would gain.

### Our current delivery system (two distinct mechanisms)

Today's outbound delivery is built from two cooperating but separate parts:

**1. A retry *engine* — GCP Pub/Sub, driven by `GCloudPubSubPushMessageQueue`**
(`src/mq/gcloud-pubsub-push/mq.ts`)

- `nativeRetrial = true`: on a delivery failure Fedify simply `throw`s and
  defers re-delivery to us.
- Two-stage retry (`handleMessage`, `mq.ts:309`): main topic → on failure
  republish to a **retry topic** (`isRetry=true`) → on the retry topic, `throw`
  so GCP's push subscription applies **exponential backoff**, up to
  `MQ_PUBSUB_MAX_DELIVERY_ATTEMPTS` (default `Infinity`).
- Failure classification (`src/mq/gcloud-pubsub-push/error-utils.ts`,
  `analyzeError`) decides `isRetryable` / `isReportable`:
  - DNS (`ENOTFOUND`/`EAI_AGAIN`), upstream SSL/TLS, and non-standard status
    codes → **not retryable, not reportable** (silent drop).
  - Network connectivity (`ECONNREFUSED`, `ETIMEDOUT`, `ECONNRESET`, socket
    hangups, …) → **retryable**, not reportable.
  - Fedify/HTTP delivery errors → retryable unless the status is in the
    permanent set `400, 401, 403, 404, 405, 410, 422, 501`.
  - Anything unrecognised → retryable **and** reportable (an app bug → Sentry).
- Multitenancy filter (`shouldDeliverActivity`, `mq.ts:153`): never deliver to
  inboxes that resolve to **internal** accounts on this instance.

**2. A per-destination gate — `account_delivery_backoffs`**
(`src/account/account.service.ts:1074`)

- This is, in effect, **our own circuit breaker**.
- `recordDeliveryFailure` is called from `handlePermanentFailure`
  (`mq.ts:429`) when a message hits a **permanent** failure (or exhausts
  `MQ_PUBSUB_MAX_DELIVERY_ATTEMPTS` when that is finite). It sets an
  **exponential backoff** window per **remote account/inbox**:
  `60s × 2ⁿ`, no cap, persisted in MySQL.
- While a backoff window is active, `getActiveDeliveryBackoff` causes
  `_enqueue` to **drop new messages** to that inbox (`mq.ts:183`).
- `clearDeliveryFailure` removes the window on the next successful delivery.

### The gap in the current system

The two mechanisms trip on **different failure classes**:

| Failure class | Current handling |
|---|---|
| Permanent (4xx in the permanent set), DNS, SSL | `account_delivery_backoffs` window → new messages dropped per **account** |
| Transient host outage (network errors, **5xx**) | Retried **per-message, per-account, forever** (default `Infinity`), with **no host-level coordination** |

So when a popular remote **host** (e.g. `mastodon.social`) has a transient
outage, every in-flight message and every one of our accounts targeting that
host independently keeps retrying it. There is **no per-host backpressure** —
the exact problem a circuit breaker exists to solve, and the one thing our
current design lacks.

### Why Fedify's circuit breaker is disabled today

Fedify's breaker, when a host's circuit opens, "holds" a message by
**re-enqueuing it with a delay**
(`enqueueHeldOutboxMessage` → `outboxQueue.enqueue(msg, { delay })`,
`middleware.ts:1268`). Our queue **drops any delayed message**
(`mq.ts:117`, *"this is a retry and we want to ignore for now"*) and the hold
path `return`s without throwing, so Pub/Sub acks and discards it. The breaker's
"retry later" therefore becomes a **silent drop**, and the held branch
pre-empts the `nativeRetrial` throw path (`middleware.ts:1633`). It is disabled
until the queue can honour delayed re-enqueues.

### Fedify circuit breaker — behaviour and defaults

From `@fedify/fedify@2.3.x` (`packages/fedify/src/federation/circuit-breaker.ts`,
`.../middleware.ts`):

- **Granularity:** per **remote host** (`getRemoteHost(inbox)`), not per inbox.
- **What opens it:** network/transport errors and **5xx** (`recordFailure`).
  4xx and 429 are "reachable" failures (`recordReachableFailure`) and **do not**
  open the circuit. 429 is excluded; `Retry-After` is honoured.
- **Defaults:** `failureThreshold: 5`, `failureWindow: 10 min`,
  `recoveryDelay: 30 min`, `heldActivityTtl: 168 h (7 days)`,
  `releaseInterval: 1 s`.
- **State machine:** closed → open (hold) → half-open (probe on `recoveryDelay`)
  → closed on a successful probe.
- **Storage:** state lives in the configured `KvStore` (`get`/`set`/`delete`,
  optional `cas`). Without `cas` it logs *"does not support CAS … updates may
  race under concurrent workers"* (`middleware.ts:693`). **Neither** our
  `RedisKvStore` nor `KnexKvStore` implements `cas` today.
- **TTL expiry:** a held activity older than `heldActivityTtl` is dropped and
  the `outboxPermanentFailureHandler` is called with `reason:
  "circuit-breaker-ttl"`.
- **Customisation:** `CircuitBreakerOptions` accepts `failureThreshold`,
  `failureWindow`, `recoveryDelay`, `heldActivityTtl`, `releaseInterval`, a
  custom `failure` predicate, and `onStateChange` / `onActivityDrop` callbacks.

## Decision

Adopt Fedify's circuit breaker as a **new, additive layer** that owns
**transient host-level backpressure**, while **keeping every existing
mechanism** that covers a different concern. The breaker replaces *nothing* we
rely on today; it fills the host-outage gap.

Target ownership after migration:

| Concern | Owner (after) | Owner (today) |
|---|---|---|
| Re-delivery of transient failures | GCP retry engine (**unchanged**) | GCP retry engine |
| Error taxonomy / Sentry reporting | `error-utils.ts` (**unchanged**) | `error-utils.ts` |
| Internal-account filtering | `shouldDeliverActivity` (**unchanged**) | `shouldDeliverActivity` |
| Permanent per-destination failures (4xx/DNS/SSL) | `account_delivery_backoffs` (**unchanged**) | `account_delivery_backoffs` |
| **Transient host outage (network/5xx) backpressure** | **Fedify circuit breaker (new)** | *(none)* |

### Prerequisites (the actual work)

These are blockers; the breaker must not be enabled until they are done.

**P1 — Make the queue honour delayed re-enqueue for circuit-held messages.**
Held messages carry `circuitHeld: true` and `circuitHeldSince`. `_enqueue`
must stop dropping them and instead deliver them *after* the requested delay.
Without this, a held message either drops (today) or, if we naively re-publish,
busy-loops every `releaseInterval` (1 s). Options:

- **(Recommended) Route held messages through the existing retry topic.**
  Detect `circuitHeld` in `_enqueue` and publish to the retry topic instead of
  dropping. GCP's exponential backoff approximates the hold delay; the circuit
  is re-evaluated on each redelivery via `beforeSend`. Reuses existing infra,
  no new dependency. Raise `releaseInterval` (e.g. 30–60 s) so re-checks are not
  excessively frequent. Ensure held re-enqueues are **not** counted as
  `handleMessage` failures (they are publishes, not handler throws), so they do
  not trip `account_delivery_backoffs`.
- **(Higher fidelity) Cloud Tasks with `scheduleTime = now + delay`.** Honours
  Fedify's exact delay, but adds a new infra dependency and delivery path.
- **(DIY) A `held_deliveries` table + periodic sweeper** that re-publishes when
  due — mirrors the `account_delivery_backoffs` pattern but is more code to own.

**P2 — Decide on `cas` / accept racy counting.** We run multiple Cloud Run
instances. Without `KvStore.cas`, concurrent workers can under-count failures
(the circuit opens a little later than `failureThreshold` suggests). Options:
add a `cas` method to `RedisKvStore`/`KnexKvStore` (Redis: `WATCH`/`MULTI` or a
Lua script; MySQL: a conditional `UPDATE … WHERE`), or accept the imprecision —
it is a threshold, and slightly late opening is not dangerous. Recommendation:
ship accepting the race, add `cas` later if metrics show it matters.

**P3 — Reconcile with `account_delivery_backoffs` when `MAX_DELIVERY_ATTEMPTS`
is finite.** If that env is finite, transient exhaustion currently records an
account backoff. To avoid double-gating transient failures, stop recording
account backoff for *retryable* (transient) exhaustion and let the breaker own
it; keep recording for *permanent* failures. If `MAX_DELIVERY_ATTEMPTS` stays
`Infinity`, there is no overlap and no change is needed here.

### Migration plan (phased)

1. **Prereq build-out.** Implement P1 (held re-enqueue) behind a flag; unit +
   integration tests for: held message is re-delivered after delay, not dropped,
   not double-counted as a delivery failure, and dropped only at
   `heldActivityTtl`.
2. **Wire observability first.** Add an `outboxPermanentFailureHandler` that
   handles `reason: "circuit-breaker-ttl"` (log + metric), and pass
   `onStateChange` to emit a structured log/metric on every open/close. (We do
   not pass `meterProvider`, so we wire our own logging rather than rely on
   Fedify's OTel instruments — or pass `meterProvider` if we want the built-in
   metrics.)
3. **Enable in staging** with conservative options (see Configuration), behind
   an env flag (e.g. `FEDIFY_CIRCUIT_BREAKER=true`) so it can be toggled without
   a deploy. Drive a fake unreachable host (wiremock 5xx / connection refused)
   in e2e and assert the circuit opens, holds, and recovers.
4. **Reconcile P3** and remove transient-exhaustion account backoff if
   `MAX_DELIVERY_ATTEMPTS` is finite in prod.
5. **Enable in production**, monitor open/close rate and held/abandoned counts,
   then make it the default and retire the env flag.

### Configuration (proposed starting point)

```ts
createFederation<ContextData>({
  // ...existing options...
  circuitBreaker: {
    failureThreshold: 5,        // default; tune from observed open-rate
    failureWindow: { minutes: 10 },
    recoveryDelay: { minutes: 30 },
    heldActivityTtl: { hours: 24 }, // shorter than the 7-day default: we would
                                    // rather abandon than hold a week of backlog
    releaseInterval: { seconds: 60 }, // larger than 1s to avoid frequent re-checks
                                      // given the retry-topic hold strategy (P1)
    onStateChange: (host, prev, next) => logger.warn(
      'Outbound circuit {host}: {prev} -> {next}', { host, prev, next },
    ),
  },
})
```

## Consequences

### What we keep (no functionality lost)

- **Retry engine, intact.** Transient re-delivery still flows through the GCP
  main→retry-topic→backoff path; `nativeRetrial` stays `true`. The breaker only
  decides *whether* to attempt, never replaces re-attempts.
- **Error taxonomy + Sentry reporting, intact.** `error-utils.ts` still
  classifies DNS/SSL/network/permanent and still distinguishes remote failures
  from reportable app bugs.
- **Internal-account filtering, intact.** `shouldDeliverActivity` still runs in
  `_enqueue`.
- **Permanent per-destination backoff, intact.** `account_delivery_backoffs`
  still gates 4xx/DNS/SSL — the class Fedify's breaker deliberately ignores
  (reachable failures).

### What we gain (on top of current logic)

1. **Host-level backpressure for transient outages — a capability we do not
   have today.** After 5 failures in 10 min, *all* traffic to a down host is
   gated at once, instead of every message and every account independently
   hammering it. This directly cuts wasted delivery attempts, outbound
   connection churn, and retry-topic volume during a remote outage — and
   complements ADR-0001's goal of not wasting delivery resources.
2. **A real recovery state machine.** Half-open probing re-tests the host and
   closes only when it genuinely recovers, versus our `account_delivery_backoffs`
   window that expires blindly on a timer regardless of host health — fewer
   premature re-sends and faster, verified resumption.
3. **Fewer lost activities.** Once P1 lands, held messages are **retried after
   recovery** (up to `heldActivityTtl`) instead of being dropped. Both of
   today's gates (`account_delivery_backoffs` drop-on-enqueue, and the breaker
   on the current queue) are lossy; the proposed design is loss-free for
   transient outages within the TTL.
4. **Protocol-correct throttling.** 429 is not treated as a circuit failure and
   `Retry-After` is honoured — politeness our current path does not implement.
5. **Better observability of remote health.** Per-host open/close state via
   `onStateChange` (and optional OTel circuit metrics if we pass
   `meterProvider`) gives a direct signal of which hosts are unhealthy, which we
   currently only infer from logs.

### Negative / costs

- **Real implementation work** (P1) before any benefit; done wrong it is worse
  than today (drop or busy-loop).
- **Per-host granularity** replaces per-inbox precision for the transient class:
  one dead actor on an otherwise-healthy shared host will not open the circuit
  (correct), but a flapping host gates all its inboxes together (usually
  desirable, occasionally over-broad).
- **Concurrency caveat** (P2): failure counting is racy across Cloud Run
  instances until we add `cas`.
- **Two backoff concepts to reason about** (`account_delivery_backoffs` for
  permanent, breaker for transient) — mitigated by the clear ownership table and
  the P3 reconciliation.
- **Operational surface:** a new env flag, new metrics/alerts, and a new
  permanent-failure `reason` to handle.

## Alternatives considered

- **Keep the breaker off (status quo).** Zero work, but the transient host-outage
  gap remains and we keep paying for uncoordinated retries during outages.
- **Build host-level backpressure into `account_delivery_backoffs` ourselves**
  (add a per-host row and trip on transient 5xx/network). Avoids the queue-delay
  problem, but re-implements a state machine Fedify already maintains and tests,
  and forgoes `Retry-After`/429 handling and the upstream metrics.
- **Replace the GCP retry engine with Fedify's `outboxRetryPolicy`** (turn off
  `nativeRetrial`). Largest blast radius — also needs queue delay support, and
  would discard our error taxonomy, internal-account filtering, and Sentry
  classification. Rejected.

## Open questions

- Prod value of `MQ_PUBSUB_MAX_DELIVERY_ATTEMPTS` (drives P3).
- Preferred P1 implementation: retry-topic reuse vs Cloud Tasks vs held table.
- Do we want Fedify's OTel circuit metrics (pass `meterProvider`) or only our
  own `onStateChange` logging?
- Final `heldActivityTtl` — how much backlog is worth holding for a host that
  may never return.
```
