&nbsp;
<p align="center">
  <a href="https://ghost.org/#gh-light-mode-only" target="_blank">
    <img src="https://user-images.githubusercontent.com/65487235/157884383-1b75feb1-45d8-4430-b636-3f7e06577347.png" alt="Ghost" width="200px">
  </a>
  <a href="https://ghost.org/#gh-dark-mode-only" target="_blank">
    <img src="https://user-images.githubusercontent.com/65487235/157849205-aa24152c-4610-4d7d-b752-3a8c4f9319e6.png" alt="Ghost" width="200px">
  </a>
</p>
&nbsp;

# ActivityPub

A multi-tenant ActivityPub server for [Ghost](https://ghost.org/), built with [Fedify](https://fedify.dev/). This service makes it possible for independent websites to publish their content directly to the Fediverse, enabling networked publishing to the open social web.

# Running locally for development

All requests to `/.ghost/activitypub/*`, `/.well-known/webfinger` and `/.well-known/nodeinfo` are proxied to this ActivityPub service using nginx. All other requests are forwarded to Ghost. This setup has only been tested on macOS using [Docker for Mac](https://docs.docker.com/desktop/install/mac-install/) and [OrbStack](https://orbstack.dev/).

## Setup

1. **[Install Ghost](https://ghost.org/docs/install/)** using `Install from source` instructions
2. **Expose your local port 80 (nginx) with [Tailscale](https://tailscale.com/kb/1080/cli?q=cli)** (or [ngrok](https://ngrok.com/))
    - Use `tailscale funnel 80` or `ngrok http 80` to expose your local **port 80** (not 2368!), on which **nginx** will be running
3. **Configure Ghost**
    - In the Ghost monorepo, create a `config.local.json` file under `ghost/core/config.local.json`, with the following configuration:
    ```
    {
        "url": <Tailscale or ngrok URL from step 2>
    }
    ```
4. **Start the ActivityPub Service**
    - Run `yarn dev:standalone && yarn logs` in the root directory of this project
5. **Start Ghost**
    - Run `yarn dev` in the Ghost monorepo
    - If you were already running Ghost locally, make sure to restart it!

## 🏗️ Architecture & Development Guidelines

> **For AI assistants:** See [AGENTS.md](AGENTS.md) for comprehensive guidance with code examples.
> **For developers:** See Architecture Decision Records in `/adr` for detailed rationale.

### Core Architecture Patterns

This service follows Domain-Driven Design with specific patterns:

- **Immutable Entities with Events** ([ADR-0003](adr/0003-immutable-entities-with-events.md)) - Entities return new instances with domain events
- **Result Type Pattern** ([ADR-0004](adr/0004-result-type-pattern.md)) - Use Result<T, E> for explicit error handling
- **Error Objects in Results** ([ADR-0005](adr/0005-result-type-error-objects.md)) - Enhanced Result types with contextual error objects
- **Class-Based Architecture** ([ADR-0006](adr/0006-class-based-architecture.md)) - All components use classes with dependency injection
- **Repository Pattern** ([ADR-0007](adr/0007-repository-pattern.md)) - Services orchestrate logic, repositories handle data access
- **View Pattern for Reads** ([ADR-0008](adr/0008-view-pattern-for-reads.md)) - Optimized read queries separate from write path
- **Hash-Based Lookups** ([ADR-0009](adr/0009-hash-based-database-lookups.md)) ⚠️ - ActivityPub IDs use SHA256 hashes
- **Decorator Routing** ([ADR-0010](adr/0010-decorator-based-routing.md)) - Routes defined via decorators

### Project Structure
```
src/
├── account/            # Immutable entities
├── post/               # Being migrated to immutable
├── activity-handlers/  # Class-based handlers
├── http/api/           # REST controllers
├── core/               # Shared utilities
└── dispatchers.ts      # Legacy - don't add here
```

### ⚠️ Critical Gotchas

**1. Database lookups MUST use SHA256 hashes** ([ADR-0009](adr/0009-hash-based-database-lookups.md))
- Never use `where('ap_id', apId)` - it returns empty results silently!
- Always use `whereRaw('ap_id_hash = UNHEX(SHA2(?, 256))', [apId])`
- Applies to: `ap_id`, `domain` (with LOWER), `ap_inbox_url` (with LOWER)

**2. Result types require helper functions**
- Use `isError(result)`, `getValue(result)`, `getError(result)`
- Never destructure directly like `[error, value]`

**3. Services must use repositories**
- Views can query DB directly (read optimization)
- Services MUST go through repositories (write path)

**4. Dependency injection names must match**
- Parameter `accountService` → registered as `'accountService'`
- Parameter `db` → registered as `'db'`

**5. Avoid these anti-patterns:**
- Adding to `dispatchers.ts` → create new handler classes
- Using `AccountType` → use `Account` entity
- Direct DB queries in services → use repositories
- String comparisons for AP IDs → use hash lookups

For complete code examples demonstrating correct patterns, see [AGENTS.md](AGENTS.md).

## Code formatting + linting

We use [Biome](https://biomejs.dev/) for code formatting and linting.

If you use VS Code, you can install the [Biome extension](https://marketplace.visualstudio.com/items?itemName=biomejs.biome) to get inline feedback.

To enable auto-formatting on save, you'll need to set the [default formatter](https://biomejs.dev/reference/vscode/#default-formatter) to `Biome` and enable [`Format on Save`](https://biomejs.dev/reference/vscode/#format-on-save) in your VS Code settings.

## Running Tests

- Run `yarn test` to execute tests within a Docker Compose stack.

## Migrations

`docker compose run migrate` or `docker compose run migrate-testing` will run the `up` migrations against your dev or testing db respectively.

If you would like to run other commands you can run `docker compose exec -it migrate /bin/bash` or `docker compose exec -it migrate-testing /bin/bash` - This will drop you into a shell with the `migrate` binary available as well as a `MYSQL_DB` environment variable that is correctly formated for use as the `-database` argument to the `migrate` binary

&nbsp;

# Copyright & license

Copyright (c) 2013-2026 Ghost Foundation - Released under the [MIT license](LICENSE). Ghost and the Ghost Logo are trademarks of Ghost Foundation Ltd. Please see our [trademark policy](https://ghost.org/trademark/) for info on acceptable usage.

