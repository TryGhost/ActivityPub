# 4. Dependency Injection with Awilix

Date: 2025-01-18

## Status

Accepted

## Context

The ActivityPub server requires managing ~50+ services with complex interdependencies. Manual wiring creates boilerplate, tight coupling, and difficult testing. We need automatic lifecycle management, easy mocking for tests, and type-safe dependency resolution.

## Decision

Adopt Awilix for dependency injection to manage component lifecycles and wiring.

### Example Configuration

```typescript
// /src/configuration/registrations.ts
container.register({
    // Infrastructure
    db: asValue(deps.knex),
    logging: asFunction(() => getLogger()).singleton(),

    // Services - all singleton
    accountService: asClass(AccountService).singleton(),
    postService: asClass(PostService).singleton(),

    // Controllers
    accountController: asClass(AccountController).singleton()
});
```

```typescript
export function registerDependencies(
    container: AwilixContainer,
    deps: { knex: Knex }
) {
    // Infrastructure
    container.register({
        logging: asFunction(() => getLogger(['activitypub'])).singleton(),
        db: asValue(deps.knex),
        fedifyKv: asFunction((db: Knex, logging: Logger) => {
            // Redis or MySQL based on environment
            return createKvStore(db, logging);
        }).singleton(),
    });

    // Services - all singleton
    container.register({
        accountService: asClass(AccountService).singleton(),
        postService: asClass(PostService).singleton(),
        feedService: asClass(FeedService).singleton(),
    });

    // Controllers - singleton
    container.register({
        accountController: asClass(AccountController).singleton(),
        postController: asClass(PostController).singleton(),
    });
}
```

### Service Implementation

Services declare dependencies through constructor injection:

```typescript
export class AccountService {
    constructor(
        private accountRepository: KnexAccountRepository,
        private postService: PostService,
        private events: AsyncEvents
    ) {
        // Awilix automatically injects these dependencies
    }

    async createAccount(data: CreateAccountData): Promise<Result<Account, Error>> {
        // Service logic using injected dependencies
        const account = await this.accountRepository.create(data);
        await this.events.emit(new AccountCreatedEvent(account));
        return { ok: true, value: account };
    }
}
```

## Consequences

### Positive

- Loose coupling via constructor injection
- Easy test mocking
- Automatic singleton lifecycle management
- Centralized wiring configuration
- Circular dependency detection

### Negative

- String-based resolution keys
- Runtime resolution failures
- Framework lock-in

## Key Patterns

- **Singleton services**: `asClass(Service).singleton()`
- **External values**: `asValue(knex)`
- **Factory functions**: `asFunction(() => createService()).singleton()`

### Testing Example

Tests can provide mock implementations:

```typescript
describe('AccountService', () => {
    let container: AwilixContainer;

    beforeEach(() => {
        container = createContainer();
        container.register({
            accountRepository: asValue(mockRepository),
            postService: asValue(mockPostService),
            events: asValue(new AsyncEvents())
        });
    });

    it('creates account with injected dependencies', async () => {
        const service = container.resolve<AccountService>('accountService');
        const result = await service.createAccount(data);
        expect(result.ok).toBe(true);
    });
});
```

## Implementation Notes

- Avoid service locator anti-pattern:
```typescript
// ❌ Bad
class Service {
    constructor(private container: AwilixContainer) {
        this.repo = container.resolve('repository');
    }
}

// ✅ Good
class Service {
    constructor(private repository: Repository) {}
}
```
- Services needing initialization should implement `init()` method
- All wiring centralized in `/src/configuration/registrations.ts`

## References

- [Awilix Documentation](https://github.com/jeffijoe/awilix)
