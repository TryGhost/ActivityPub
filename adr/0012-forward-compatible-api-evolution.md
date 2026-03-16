# Forward-Compatible API Evolution

## Status

Proposed

## Context

[ADR-0002](0002-frontend-backend-versioning.md) introduced a backend-driven version negotiation system where the ActivityPub server told Ghost Admin which version of the ActivityPub client to load from a CDN via a `client-config` endpoint. This ensured the frontend and backend were always compatible, regardless of the Ghost version a user was running.

The Ghost Admin architecture has since changed. The ActivityPub client is now bundled directly into the React admin shell as a native import, rather than being loaded dynamically from jsDelivr. For Ghost Pro, admin deploys independently and always has the latest client. For self-hosters, admin is bundled with their Ghost installation. Current versions of Ghost Admin no longer call the `client-config` endpoint, though older Ghost installations that have not yet upgraded may still rely on it.

This change was intentional. Since both Ghost Admin and the ActivityPub service are continuously delivered, and feature flagging is available for gating functionality, the version negotiation adds overhead and complexity without clear benefit. Bundling the client also avoids duplicating dependencies, simplifies local development (HMR etc.), and removes the jsDelivr CDN dependency.

However, the underlying problem that ADR-0002 solved still exists: **the ActivityPub client and server can drift apart**, particularly for self-hosted users. Without version negotiation, we need a different strategy to ensure compatibility.

### Deployment Scenarios

For Ghost Pro - Ghost Core, Ghost Admin, and the ActivityPub server are all deployed independently. For self-hosters - Ghost Admin is bundled with Ghost Core into a single release.

| Scenario | Client (Ghost Admin) | Server (ActivityPub) | Version relationship |
| --- | --- | --- | --- |
| Ghost Pro | Deployed independently, latest | Deployed independently, latest | Typically in sync (brief drift during independent deploys) |
| Self-hosted with proxy | Bundled with Ghost installation | Latest (Ghost Pro infra) | Server ahead of client |
| Self-hosted with Docker | Bundled with Ghost installation | Pinned to Docker image | Expected to be in sync |

The critical scenario is **self-hosted with proxy**: the user runs an older version of Ghost (with an older bundled client) but proxies ActivityPub requests to Ghost Pro's infrastructure, which always runs the latest server. If the server makes a breaking change, the older client breaks.

Self-hosted Docker users are expected to keep their Ghost and ActivityPub versions in sync. While version drift in this scenario is ultimately a user responsibility, the forward-compatible approach in this ADR still benefits these users: additive-only server changes mean that even if versions drift temporarily, older clients are less likely to break.

## Decision

### Scope

This ADR covers the API endpoints under `/.ghost/activitypub/:version/` that are consumed by the ActivityPub client bundled in Ghost Admin. These are the endpoints defined using the `APIRoute` decorator.

It does not cover:

- **Webhook endpoints** (`/.ghost/activitypub/v1/webhooks/*`): these are defined in this codebase but called by Ghost Core when posts are published, updated, or deleted. Changes to these endpoints require coordination with Ghost Core and are outside the scope of this ADR.
- **Federation endpoints** (inbox, outbox, webfinger, etc.): these are governed by Fedify and are outside the scope of this ADR.

### Approach

Adopt a forward-compatible API evolution strategy, inspired by [GraphQL's approach to schema evolution](https://graphql.org/learn/schema-design/#versioning): evolve the API continuously through additive changes, avoid breaking changes, and use per-endpoint versioning as an escape hatch when a breaking change is unavoidable.

### Principles

1. **Additive only**: add new endpoints, fields, and optional parameters freely
2. **Never remove, rename, or change**: existing fields, endpoints, and their semantics are stable
3. **Per-endpoint versioning for breaking changes**: when a breaking change is unavoidable, introduce a new version of that specific endpoint (e.g. `/v2/notifications` alongside `/v1/notifications`)
4. **Deprecation window**: deprecated endpoint versions are supported for a defined deprecation period after the replacement ships. The concrete duration of this period has not yet been established and should be decided before the first breaking change that requires per-endpoint versioning. Factors to consider include Ghost's release cadence, self-hoster update patterns, and the severity of the change

### Deprecating the client-config endpoint and npm package

Ghost Admin has transitioned from a legacy Ember admin to a new React admin shell. The React shell imports the ActivityPub client directly as a bundled React module, bypassing the `client-config` endpoint and jsDelivr CDN entirely. The React shell is now the default for all users, and the Ember admin is being phased out.

However, the legacy loading infrastructure still exists in the Ghost codebase:

- The Ember admin's `admin-x-component.js` still fetches `/.ghost/activitypub/stable/client-config` and loads from jsDelivr when the React shell is not active
- The CI pipeline (`.github/workflows/ci.yml`) still publishes `@tryghost/activitypub` to npm and purges the jsDelivr cache
- A pre-commit hook prompts developers to bump the activitypub package version on changes

To complete the transition to the model described in this ADR:

1. The `client-config` endpoint should be kept functional until traffic from older installations has dropped to negligible levels, then removed
2. The CI pipeline in Ghost should be updated to stop publishing the npm package
3. The pre-commit hook for activitypub version bumping should be removed
4. The npm package should be deprecated with a notice that the client is now bundled with Ghost Admin

Ghost installations that have not upgraded to the bundled client will remain on the last published npm package version. These users will continue to work (the forward-compatible approach means additive server changes won't break their older client), but they will not receive new client features or bug fixes until they upgrade Ghost.

### Keeping per-endpoint version infrastructure

The existing version infrastructure remains useful and should be kept:

- The `APIRoute` decorator's version parameter (used today by the bluesky `v2` endpoints)
- The `:version` URL prefix on API routes (`/.ghost/activitypub/:version/...`)
- The version validation middleware that returns 410 Gone for unsupported versions
- The `DEFAULT_API_VERSION = 'v1'` constant

These support the per-endpoint versioning escape hatch without the complexity of global version negotiation.

New endpoints should default to `v1` (the `DEFAULT_API_VERSION`). A new endpoint should only use a higher version number if it is replacing an existing versioned endpoint as part of a breaking change (e.g. `/v2/notifications` replacing `/v1/notifications`).

### Impact of Change Types

The following table defines whether a change is safe to ship without per-endpoint versioning, considering the proxy scenario (server ahead of client):

#### Safe Changes (ship freely)

| Change | Why it's safe |
| --- | --- |
| Add a new endpoint | Old client never calls it |
| Add a field to a response | Old client ignores unknown fields |
| Add an optional field to a request | Server uses default when absent |
| Make a required request field optional | Old client still sends it, server still accepts it |
| Loosen auth requirements | Old client still sends auth, still works |
| Split an endpoint into multiple | Keep the original working alongside the new ones |

#### Unsafe Changes (require per-endpoint versioning or an alternative approach)

| Change | Risk | Approach |
| --- | --- | --- |
| Remove a response field | Old client reads `undefined`, may crash | Keep returning the field; if data no longer exists, return a sensible zero value (empty string, 0, empty array) rather than null (see nullable risk below) |
| Rename a response field | Same as removing the old name | Return both old and new field names |
| Change a field's type | Old client parses wrong type (e.g. number vs string) | Add a new field with the new type, keep the old field |
| Change a field's semantics | Old client silently shows wrong data | Add a new field with the new semantics, keep the old field's meaning |
| Change a response structure | Old client can't parse the response | Per-endpoint versioning (e.g. `/v1/notifications` returns array, `/v2/notifications` returns paginated object) |
| Make an optional request field required | Old client doesn't send it, gets 400 | Use a server-side default when the field is absent |
| Tighten auth requirements | Old client gets 403 where it expected 200 | Ship immediately if security-related; otherwise coordinate with a Ghost Admin update |
| Remove an endpoint | Old client gets 404 | Keep it returning an empty/sensible response for the deprecation period |
| Change URL path structure | Old client hardcodes the old path | Add the new path as an alias, keep the old path working |

#### Risky Changes (safe if clients are well-behaved, but worth caution)

| Change | Risk | Approach |
| --- | --- | --- |
| Add a new enum value to a response field | Old client may not handle unknown values in a switch/match | Clients should always have a default/fallback case; consider impact before shipping |
| A field becomes nullable | Old client may crash on null where it expected a value | Return an empty value (empty string, 0) instead of null for backward compatibility; add a separate nullable field if the distinction matters |
| Change default behavior (sort order, page size) | Response shape is the same but results differ | Add a query parameter for the new behavior (e.g. `?sort=ranked`), keep the existing default |
| Change error response format | Old client's error handling parses the old shape | Add new fields alongside old ones, or only change error format on new versioned endpoints |

### Process for Breaking Changes

When a breaking change is unavoidable:

1. Introduce the new endpoint at a new version (e.g. `/v2/notifications`) alongside the existing one
2. Ship a Ghost Admin update with a client that calls the new version
3. Keep the old version working for the deprecation period (see Principles above)
4. Before removing the old version, verify it is safe to do so (see below)
5. Remove the old version or return 410 Gone (the middleware already supports this)

During the deprecation period, both implementations are maintained. This is a cost, but breaking changes should be rare enough to be manageable.

#### Verifying it is safe to remove a deprecated endpoint

Before removing a deprecated endpoint version, check server request logs for traffic on the old version. If self-hosters are still sending requests to `/v1/notifications` after the deprecation period has passed, they are on an old Ghost version and will break.

In practice:

- If the deprecated version is receiving negligible traffic, remove it
- If it is still receiving meaningful traffic, extend the deprecation period or accept the breakage with advance notice (e.g. a Ghost changelog entry warning self-hosters to update)
- If request logging is not available, err on the side of keeping the old version longer rather than removing it blind

### Release Process

The order in which changes are deployed matters. The ActivityPub server and the Ghost Admin client are deployed independently, so there is always a window where one is ahead of the other. The server should always be deployed first, because proxy self-hosters always run the latest server but may run an older client.

**Rule: the server must never depend on client changes, and the client must never ship before the server endpoints it depends on are live.**

#### Coordinating with feature flags

In practice, client and server changes for a feature are often developed in parallel. The approach depends on whether the change introduces a new endpoint or modifies an existing one.

**New endpoint**: a server-side feature flag is not needed - a new endpoint that nobody calls is harmless. Only the client needs a feature flag to hide the UI until it's ready:

1. Add the server-side endpoint (deployed and live, but no client calls it yet)
2. Ship client-side code behind a feature flag (deployed but hidden)
3. When ready, remove the client-side feature flag (client now calls the endpoint)

Until the client flag is removed, the endpoint is effectively in development and can be changed freely.

**Modifying an existing endpoint**: if the change affects current behavior and needs to be developed iteratively, a server-side feature flag is useful. The client opts in via a URL parameter, and existing clients continue getting the old behavior:

1. Ship the server change behind a feature flag (existing behavior is unchanged unless the flag is present)
2. Ship client-side code behind a feature flag that passes the server flag via URL parameter
3. When ready, remove both feature flags (new behavior becomes the default)

Note: for additive changes to existing endpoints (adding a new response field, adding an optional parameter), no feature flags are needed on either side - just ship it.

The ActivityPub React app has its own feature flag mechanism (`apps/activitypub/src/lib/feature-flags.tsx`) that uses URL parameters and localStorage. Flags are toggled via `?flag-name=ON` in the URL and accessed via a `useFeatureFlags()` hook. The server's `FlagService` is request-scoped and activated via URL query parameters passed by the client.

For simpler changes where feature flags are unnecessary, sequencing the PRs (server merged first) is sufficient.

#### New feature (client and server)

Example: adding a bookmarks feature with a new `GET /v1/bookmarks` endpoint and a new bookmarks screen in the client.

1. Ship the server with the new endpoint
2. Ship a Ghost Admin update with the client that calls the endpoint

If the client shipped first, it would call `/v1/bookmarks` on a server that doesn't have it yet, resulting in 404s. Server-first means the endpoint exists (unused) until the client catches up.

For Ghost Pro, both deploy independently - the server endpoint should be live before the admin deploy that uses it. For proxy self-hosters, step 1 happens immediately (Ghost Pro deploys continuously). Step 2 happens whenever they update Ghost. The endpoint is available and waiting.

#### New feature (server only)

Example: adding support for a new ActivityPub protocol extension, or a new federation behavior.

1. Ship the server

No client coordination needed. The client is unaffected.

#### New feature (client only)

Example: a UI redesign of an existing screen that uses the same API endpoints.

1. Ship a Ghost Admin update with the client changes

No server coordination needed. The API is unchanged.

#### Additive API change (new field or optional parameter)

Example: adding an `avatarUrl` field to the account endpoint response.

1. Ship the server with the new field in the response
2. Ship a Ghost Admin update with the client that uses the new field

Same order as a new feature. Old clients ignore the field until they're updated.

#### Breaking change (per-endpoint versioning)

Example: changing the notifications endpoint from returning an array to a paginated object.

1. Ship the server with the new `/v2/notifications` endpoint alongside the existing `/v1/notifications`
2. Ship a Ghost Admin update with the client that calls `/v2/notifications`
3. After the deprecation period, remove `/v1/notifications` from the server

Both versions coexist on the server during the deprecation period. Proxy self-hosters on old Ghost versions continue using `/v1/notifications`. Once they update Ghost past the deprecation boundary, their client switches to `/v2/notifications`.

#### Security fix

Example: a vulnerability requires changing an endpoint's behavior in a way that is not forward-compatible.

1. Ship the server fix immediately

Security fixes are the one case where backward compatibility may be intentionally broken without a deprecation period. The priority is protecting users, not maintaining compatibility with old clients. A client update in Ghost Admin should be shipped as quickly as possible to match.

### Guidance for Self-Hosted Docker Users

Self-hosted users running ActivityPub in Docker should keep their Ghost and ActivityPub container versions in sync. Version drift between the client (bundled with Ghost) and server (Docker container) can cause issues in either direction:

- **Ghost updated, Docker not**: the client may call endpoints or expect fields that the older server doesn't support
- **Docker updated, Ghost not**: the same risks as the proxy scenario, mitigated by this ADR's forward-compatible approach

Keeping versions in sync avoids both cases. The forward-compatible approach means that temporary drift (e.g. during a rolling update) is unlikely to cause issues, but sustained drift should be avoided.

### Enforcement

Forward compatibility depends on developer discipline. A single careless field removal or type change can silently break proxy self-hosters, and the team may not hear about it quickly.

To mitigate this:

- **PR review**: changes to API controller response shapes should be reviewed with the change type tables in this ADR in mind. Removing or renaming a field in a response should be caught in review.
- **Test coverage**: integration tests for API endpoints should assert on response shapes. A test that checks for the presence of specific fields will fail if someone removes one, catching the issue before it ships.
- **Future consideration**: if breaking changes become a recurring problem, consider adding a CI check that diffs API response types against the previous release to flag removals or type changes automatically. This is not necessary today but worth revisiting if the API surface grows significantly.

## Consequences

**Positive:**
- Simpler deployment model: no dynamic client loading or extra HTTP request on page load, and the jsDelivr CDN dependency is phased out as older installations upgrade
- Local development works with HMR
- No duplicated dependencies from building the client separately
- Well-understood approach used by mature REST APIs and formalized by GraphQL
- Per-endpoint versioning escape hatch is already implemented and proven (bluesky `v2` endpoints)

**Negative:**
- API surface accumulates over time (deprecated fields are kept, renamed fields return both names)
- Requires discipline from every developer touching the API; one careless removal breaks proxy self-hosters silently
- When a breaking change is needed, both old and new endpoint versions must be maintained during the deprecation period
- No mechanism to force old clients to upgrade (unlike the old model where `client-config` instantly pointed all clients at the new version)

**Neutral:**
- Self-hosted Docker users are expected to manage their own version alignment, though the forward-compatible approach reduces the impact of temporary drift
- The `v1` prefix on most API routes becomes a permanent part of the URL rather than an evolving version indicator
