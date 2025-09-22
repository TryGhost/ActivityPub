# ActivityPub AI Assistant Guide

This file provides comprehensive guidance for AI agents contributing to this repository.

> **Note:** This document contains detailed code examples and implementation patterns. For a concise human-readable overview, see [README.md](README.md).

## Project Overview

A multitenant ActivityPub server for [Ghost](https://ghost.org/), built with
[Fedify](https://fedify.dev/). This service makes it possible for independent
websites to publish their content directly to the Fediverse, enabling networked
publishing to the open social web

## Tools & Technologies Used

- [Node.js](https://nodejs.org) - Runtime
- [TypeScript](https://www.typescriptlang.org) - Programming language
- [Yarn](https://yarnpkg.com) - Node package management
- [Biome](https://biomejs.dev) - Linter & code formatter
- [esbuild](https://esbuild.github.io/) - Bundler
- [Hono](https://hono.dev) - Web Server
- [Fedify](https://fedify.dev) - Federation
- [Awilix](https://github.com/jeffijoe/awilix) - Dependency injection
- [Zod](https://zod.dev) - Schema validation
- [Knex](https://knexjs.org/) - SQL query builder
- [Vitest](https://vitest.dev) - Testing (unit / integration)
- [Cucumber](https://cucumber.io) - Testing (e2e)
- [Wiremock](https://wiremock.org) - API mocking (for e2e tests)
- [migrate](https://github.com/golang-migrate/migrate) - Database migrations
- [Docker](https://www.docker.com) - Containerisation
- [Docker Compose](https://docs.docker.com/compose) - Container orchestration
- [MySQL](https://www.mysql.com) - Database
- [Google Cloud Cloud Run](https://cloud.google.com/run) - Production deployment
- [Google Cloud Cloud SQL](https://cloud.google.com/sql) - Production database deployment
- [Google Cloud Pub/Sub](https://cloud.google.com/pubsub) - Production messaging
- [Google Cloud Cloud Storage](https://cloud.google.com/storage) - Production file storage

---

## Repository Structure

- `/dev` - Development related tools, configurations, and utilities
- `/features` - Cucumber feature files for e2e testing
- `/jobs` - One-off jobs to be executed in a production environment (Google Cloud)
- `/migrate` - Database migrations
- `/src` - Source code for the application

---

## Code Quality

### Linting & formatting

To run the linter:

```bash
yarn lint
```

To run the formatter:

```bash
yarn fmt
```

### Type checking

To run type checking:

```bash
yarn test:types
```

### Testing

To run all tests (slow):

```bash
yarn test
```

To run unit tests only (fast):

```bash
yarn test:unit
```

To run integration tests only (slow):

```bash
yarn test:integration
```

To run e2e tests only (slow):

```bash
yarn test:cucumber
```

To run a single unit / integration test (fast):

```bash
yarn test:single 'path/to/test'
```

To run a single e2e test (slow):

1. Add a `@only` tag either above a feature file OR a scenario in a feature file:

```cucumber
# hello-world.feature

@only
Feature: Hello world

    Scenario: It prints "Hello, world!"
        ...
```

2. Run the test:

```bash
yarn test:cucumber @only
```

#### Testing Guidelines:

- Cover as much as possible with unit tests
- Use integration tests for anything that cannot be reasonably unit tested
- Use e2e tests to cover features at a high level
- All unit & integration test files should have the prefix `.test.ts`
- The type of test should be indicated by the file extension:
  - `.unit.test.ts` for unit tests
  - `.integration.test.ts` for integration tests
- Tests should be co-located with the code they test
- e2e tests should reside in the `features` directory
- Tests should execute quickly, there is an upper limit of 10 seconds

#### Testing Notes:

- Tests are executed within a Docker container when executed via `yarn`. This
  means extra flags passed to `yarn` will not be passed to the test runner

---

## Development Environment

### Setup

#### Using Tailscale

Use [Tailscale](https://tailscale.com) to expose the local machine to the internet:

```bash
tailscale funnel 80
```

### Services

- [Nginx](https://nginx.org) - Reverse proxy used to proxy traffic from port
  `80` to port `8080` if traffic is meant for activitypub, or forward on to the
  docker host (`host.docker.internal`) for any other traffic (i.e Ghost)
- [MySQL](https://www.mysql.com) - Database
  - Port: `3307`
  - User: `ghost`
  - Password: `password`
  - Database: `activitypub`
- [Google Cloud Pub/Sub emulator](https://cloud.google.com/pubsub/docs/emulator) - Pub/Sub emulator
  - Port: `8085`
- [Google Cloud Storage emulator](https://github.com/fsouza/fake-gcs-server) - Storage emulator
  - Port: `4443`

### Run the application

```bash
yarn dev
```

### Run the application with logging to the console

```bash
yarn dev && yarn logs
```

### Stop the application

```bash
yarn stop
```

This will also stop any service dependencies

### Wipe the database

```bash
yarn wipe-db
```

### Fix the environment

When there are issues with the environment, this command will attempt to resolve them:

```bash
yarn fix
```

---

## Database Migrations

### Creating a new migration

```bash
yarn migration 'name-of-migration'
```

Do not use spaces in the name of the migration

### Running migrations

```bash
yarn migrate
```

This will run any migrations that have not yet been applied

### Rolling back migration

Currently unsupported

### Notes

- Migrations are run automatically when the application is started via: `yarn dev`

---

## Architecture Patterns

**📚 See `/adr` directory for Architecture Decision Records**

- Dependency injection is heavily used to manage dependencies and facilitate
  testing
- The `Result` pattern is preferred over throwing errors, with an exhaustive
  check on the result to ensure that all possible errors are handled
- Business logic is modelled in the entities
- Repositories are used to abstract away the database operations
  - Repositories should not be used directly, they should be used through the
    services
- Services are used to orchestrate business logic
  - Services can depend on other services
- Controllers should only be lean and delegate to services where appropriate
- Views are used at the HTTP layer to present data to the client in a fast and
  efficient way
  - Views can talk directly to the database if necessary
  - Views should not be responsible for any business logic

### Read/Write Separation

The codebase follows a CQRS-inspired pattern:

**Write Path (Commands):**
- Controller → Service → Repository → Entity
- Follows strict layering and repository pattern
- Handles business logic, validations, and domain events

**Read Path (Queries):**
- Controller → View → Database
- Views make optimized queries directly to the database
- Returns DTOs with presentation-ready data
- Includes user-specific context (e.g., followedByMe, blockedByMe)

---

## Critical Patterns & Gotchas

### Database Lookups Use SHA256 Hashes

⚠️ **Never use direct string comparisons for ActivityPub IDs** - see [ADR-0009](adr/0009-hash-based-database-lookups.md)

```typescript
// ❌ WRONG - Returns no results!
await db('accounts').where('ap_id', apId)

// ✅ CORRECT - Use hash lookup
await db('accounts').whereRaw('ap_id_hash = UNHEX(SHA2(?, 256))', [apId])
```

### Result Type Usage

Always use the helper functions with Result types:

```typescript
// ✅ CORRECT - Use helpers
const result = await someFunction();
if (isError(result)) {
  const error = getError(result);
  // handle error
} else {
  const value = getValue(result);
  // use value
}

// ❌ WRONG - Don't destructure directly
const [error, value] = someResult;  // Implementation detail - don't do this!
```

### Dependency Injection Names Must Match

Awilix uses CLASSIC injection mode - parameter names must match registration names:

```typescript
constructor(
  private readonly accountService: AccountService,  // Must be registered as 'accountService'
  private readonly db: Knex,                       // Must be registered as 'db'
)
```

### Routes Use Decorators

Routes are defined using decorators, not direct registration - see [ADR-0010](adr/0010-decorator-based-routing.md)

```typescript
@APIRoute('GET', 'account/:handle')  // Defines route
@RequireRoles(GhostRole.Owner)       // Adds role check
async handleGetAccount() { }
```

### Legacy Code Warning

`dispatchers.ts` contains 1100+ lines of legacy factory functions. New handlers should follow the class-based pattern in `/activity-handlers/` - see [ADR-0006](adr/0006-class-based-architecture.md)

---

## Code Conventions

### e2e testing

- Step definitions should be grouped together by the high level feature they are
  testing, i.e: Step definitions related to "reposting" should be grouped together
  in `features/step_definitions/repost_steps.js`
  - This is not necessarily a 1-to-1 mapping between feature files and step
    definition files

---

## Code Patterns

These patterns are based on our architecture decisions (see `/adr` directory):

### Immutable Entities with Domain Events

```typescript
// ❌ Avoid: Mutable entities with dirty flags
class Post {
  private _likeCount: number;
  private _likeCountDirty: boolean;

  like() {
    this._likeCount++;
    this._likeCountDirty = true;
  }
}

// ✅ Prefer: Immutable entities that generate events
class Post {
  constructor(
    readonly id: string,
    readonly likeCount: number,
    private events: DomainEvent[] = []
  ) {}

  like(): Post {
    const newPost = new Post(this.id, this.likeCount + 1);
    newPost.events.push(new PostLikedEvent(this.id));
    return newPost;
  }

  pullEvents(): DomainEvent[] {
    return [...this.events];
  }
}
```

### Error Objects in Result Types

```typescript
// ❌ Avoid: String literal errors without context
Result<Account, 'not-found' | 'network-error'>

// ✅ Prefer: Error objects with context
type AccountError =
  | { type: 'not-found'; accountId: string }
  | { type: 'network-error'; retryable: boolean }

async function getAccount(id: string): Promise<Result<Account, AccountError>> {
  const account = await repository.findById(id);
  if (!account) {
    return error({ type: 'not-found', accountId: id });
  }
  return ok(account);
}

// Usage with exhaustive handling
const result = await getAccount('123');
if (isError(result)) {
  const err = getError(result);
  switch (err.type) {
    case 'not-found':
      log(`Account ${err.accountId} not found`);
      break;
    case 'network-error':
      if (err.retryable) retry();
      break;
    default:
      exhaustiveCheck(err);
  }
}
```

### Class-Based Architecture

```typescript
// ❌ Avoid: Function factories
export function createFollowHandler(accountService: AccountService) {
  return async function handleFollow(ctx: Context, follow: Follow) {
    // implementation
  }
}

// ✅ Prefer: Classes with dependency injection
export class FollowHandler {
  constructor(
    private readonly accountService: AccountService,
    private readonly notificationService: NotificationService
  ) {}

  async handle(ctx: Context, follow: Follow) {
    // implementation
  }
}

// Registration with Awilix
container.register('followHandler', asClass(FollowHandler).singleton())
```

### Repository Pattern

```typescript
// ❌ Avoid: Direct database queries in services
class AccountService {
  async getFollowers(accountId: number) {
    return await this.db('follows')
      .join('accounts', 'accounts.id', 'follows.follower_id')
      .where('follows.following_id', accountId);
  }
}

// ✅ Prefer: Repository handles all data access
class AccountRepository {
  async getFollowers(accountId: number) {
    return await this.db('follows')
      .join('accounts', 'accounts.id', 'follows.follower_id')
      .where('follows.following_id', accountId);
  }
}

class AccountService {
  constructor(private readonly accountRepository: AccountRepository) {}

  async getFollowers(accountId: number) {
    return await this.accountRepository.getFollowers(accountId);
  }
}
```

### View Pattern for Reads

```typescript
// Views are used for complex read operations that need optimization
export class AccountView {
  constructor(private readonly db: Knex) {}

  async viewById(id: number, context: ViewContext): Promise<AccountDTO> {
    // Direct database query with complex joins and aggregations
    const accountData = await this.db('accounts')
      .innerJoin('users', 'users.account_id', 'accounts.id')
      .select(
        'accounts.*',
        this.db.raw('(select count(*) from posts where posts.author_id = accounts.id) as post_count'),
        this.db.raw('(select count(*) from follows where follows.follower_id = accounts.id) as following_count')
      )
      .where('accounts.id', id)
      .first();

    // Add user-specific context
    const followedByMe = context.requestUserAccount
      ? await this.db('follows')
          .where('follower_id', context.requestUserAccount.id)
          .where('following_id', id)
          .first() !== undefined
      : false;

    // Return presentation-ready DTO
    return {
      id: accountData.id,
      handle: accountData.handle,
      postCount: accountData.post_count,
      followingCount: accountData.following_count,
      followedByMe
    };
  }
}
```

---

## Common Workflows

### Adding / changing functionality

- When adding / changing functionality, you should ensure that the code is:
  - Covered by tests at the appropriate level (i.e not every test requires an e2e test)
  - Free of linting errors
  - Free of type errors
  - Following existing code conventions (explicitly and implicitly)
  - Following the architecture patterns outlined in the architecture patterns section
  - Improving the overall quality of the codebase

---

## Performance

- It is important that the application has a quick boot time, especially when
  running in a cloud environment like Google Cloud Run. Synchronous operations
  should be avoided during boot (where possible) and any operation that cannot
  be asynchronous should be reviewed for the impact it has on the boot time

---

## Quirks

Known things that are a little weird or not ideal:
