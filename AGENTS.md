# ActivityPub — agent guide

A multitenant ActivityPub server for [Ghost](https://ghost.org/), built with
[Fedify](https://fedify.dev/), that publishes independent websites to the
Fediverse. See [README.md](README.md) for the human overview and `/adr` for the
Architecture Decision Records that own the rationale behind the patterns below.

Stack (versions in `package.json` / `docker-compose.yml`): Node + TypeScript,
Hono, Fedify, Awilix (DI), Zod, Knex + MySQL, Vitest (unit/integration),
Cucumber + Wiremock (e2e), Biome (lint/format), esbuild. Runs in Docker Compose
locally; Google Cloud Run in production.

## Commands

Tests run inside a Docker container via `yarn`, so **extra flags passed to
`yarn` do not reach the test runner** — use the dedicated scripts below.

```bash
yarn lint                       # Biome lint
yarn fmt                        # Biome format
yarn test:types                 # type check
yarn test                       # everything (slow)
yarn test:unit                  # unit only (fast)
yarn test:integration           # integration only (slow)
yarn test:cucumber              # e2e only (slow)
yarn test:single 'path/to/test' # single unit/integration test (fast)
```

Run a single e2e test by tagging a `Feature` or `Scenario` with `@only`, then
`yarn test:cucumber @only`.

```bash
yarn dev            # start app (also runs pending migrations)
yarn logs           # tail app logs  (yarn dev && yarn logs to do both)
yarn stop           # stop app + service deps
yarn wipe-db        # wipe the database
yarn fix            # attempt to repair a broken local environment
```

Local services: nginx `:80`→`:8080`, MySQL `:3307` (user `ghost` / pass
`password` / db `activitypub`), Pub/Sub emulator `:8085`, GCS emulator `:4443`.
Expose port 80 to the internet with `tailscale funnel 80`.

## Migrations

```bash
yarn migration 'name-of-migration'   # create (no spaces in the name)
yarn migrate                         # apply pending migrations
```

Migrations also run automatically on `yarn dev`. **Rollback is unsupported** —
migrations are forward-only, so treat applied migrations as immutable.

## Boundaries — what not to touch

- **Never commit secrets.** Local dev credentials above are throwaway; nothing
  else belongs in the repo.
- **Don't add to `dispatchers.ts`** — 1100+ lines of legacy factory functions.
  New handlers go in `/activity-handlers/` as classes ([ADR-0006](adr/0006-class-based-architecture.md)).
- **Don't use `AccountType`** — use the `Account` entity.
- **Don't query the DB directly from services** — go through repositories.
- **Don't string-compare ActivityPub IDs** — use hash lookups (see below).

## Critical gotchas

An agent will get these wrong without being told:

**Database lookups use SHA256 hashes** ([ADR-0009](adr/0009-hash-based-database-lookups.md)).
Direct string comparison silently returns no rows. Applies to `ap_id`, `domain`
(with `LOWER`), `ap_inbox_url` (with `LOWER`).

```typescript
// ❌ WRONG — returns no results, no error
await db('accounts').where('ap_id', apId)
// ✅ CORRECT
await db('accounts').whereRaw('ap_id_hash = UNHEX(SHA2(?, 256))', [apId])
```

Hash columns are **stored generated columns**, not application-computed:
`BINARY(32) GENERATED ALWAYS AS (UNHEX(SHA2(col, 256))) STORED`. App code only
does the lookup above.

**Result types** — always use the helpers, never destructure:

```typescript
if (isError(result)) { const err = getError(result); /* ... */ }
else { const value = getValue(result); /* ... */ }
// ❌ const [error, value] = result   // implementation detail
```

Prefer error *objects* with context (`{ type: 'not-found'; accountId }`) over
string literals, and exhaustively switch on `err.type` with an `exhaustiveCheck`
default ([ADR-0004](adr/0004-result-type-pattern.md), [ADR-0005](adr/0005-result-type-error-objects.md)).

**Awilix uses CLASSIC injection** — constructor parameter names must match the
registration name exactly (`accountService` ↔ `'accountService'`, `db` ↔ `'db'`).

**Routes use decorators** ([ADR-0010](adr/0010-decorator-based-routing.md)), not
direct registration:

```typescript
@APIRoute('GET', 'account/:handle')
@RequireRoles(GhostRole.Owner)
async handleGetAccount() { }
```

**Don't leak wire-format names into internal code.** Use codebase-natural names
internally and translate only at the serialization boundary; Fedify is the
reference for the internal name. E.g. the field is `aliases` internally
(`account_aliases.ap_id` column) and Fedify emits `alsoKnownAs` in JSON-LD via
the `aliases:` constructor key — not `alsoKnownAs` everywhere.

## Architecture

Domain-Driven, CQRS-inspired. Full rationale in `/adr`; the non-obvious rules:

- **Write path:** Controller → Service → Repository → Entity. Repositories are
  reached only through services; controllers stay lean.
- **Read path:** Controller → View → Database. Views may query the DB directly
  and return presentation-ready DTOs (incl. per-user context like
  `followedByMe`), but hold no business logic ([ADR-0008](adr/0008-view-pattern-for-reads.md)).
- **Immutable entities** return new instances and emit domain events; no dirty
  flags ([ADR-0003](adr/0003-immutable-entities-with-events.md)).
- **Entities are write-side only for relational data.** Collections backed by a
  separate table (blocks, follows, aliases) are not entity fields — `addX`/
  `removeX` emit events and the repository persists them in `save()`; reads go
  through the repository or a view (e.g. `accountRepository.getAliases(id)`).
- **Many-to-many / one-to-many relations get their own table**, shaped like
  `blocks`: surrogate `id`, `created_at`, hash-indexed `(parent_id, target_hash)`
  unique constraint, FK cascade. JSON columns are only for fixed-shape display
  data (e.g. `accounts.custom_fields`).

## Conventions

- **HTTP route paths:** current-user resources live at top level (`aliases`,
  `blocks/accounts`, `notifications`, `feed/*`). The `account/:handle` namespace
  is reserved for routes targeting a specific account — don't nest current-user
  resources under it (conflicts with the `:handle` segment).
- **Tests** are co-located with the code, named `*.unit.test.ts` /
  `*.integration.test.ts`, and must run in under 10 seconds. Prefer unit tests;
  use integration only for what can't be unit tested; use e2e for high-level
  feature coverage.
- Assert on the specific field (`expect(result.field).toEqual(...)`), never
  `expect(JSON.stringify(result)).toContain(...)` — the latter passes on a match
  in any field and hides bugs.
- When adding a table, also add it to `FixtureManager.reset()` so integration
  tests stay isolated.
- **e2e step definitions** are grouped by feature (e.g. all reposting steps in
  `features/step_definitions/repost_steps.js`), not 1:1 with feature files.

## Before you commit

Code must pass `yarn lint`, `yarn test:types`, and the relevant tests, follow
the patterns above, and carry tests at the appropriate level (not everything
needs an e2e test).

**Boot time matters** — the app runs on Cloud Run, so avoid synchronous work
during boot; review anything that can't be async for its startup cost.
