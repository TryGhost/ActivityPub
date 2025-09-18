# 4. Dependency Injection with Awilix

Date: 2025-01-18

## Status

Accepted

## Context

The ActivityPub server has ~50+ services, repositories, and controllers with complex interdependencies. Manual dependency management would require extensive boilerplate and make testing difficult.

Key requirements:
- Singleton lifecycle for stateful services
- Easy mocking for tests
- Clear dependency graphs
- Type safety with TypeScript

## Decision

We will use Awilix as our Dependency Injection (DI) container to manage component lifecycles and dependencies.

### Container Configuration

The container is configured in `/src/configuration/registrations.ts`:

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
        private fediverseBridge: FediverseBridge,
        private events: AsyncEvents,
        private logging: Logger
    ) {}

    async createAccount(data: CreateAccountData): Promise<Result<Account, Error>> {
        // Service logic using injected dependencies
        const account = await this.accountRepository.create(data);
        await this.events.emit(new AccountCreatedEvent(account));
        return { ok: true, value: account };
    }
}
```

### Resolution at Runtime

Dependencies are resolved from the container:

```typescript
// In app.ts
const container = createContainer();
registerDependencies(container, { knex });

// Resolution
const accountService = container.resolve<AccountService>('accountService');
const fedify = container.resolve<Federation>('fedify');

// In routes
app.get('/account/:id', (ctx) => {
    const controller = container.resolve<AccountController>('accountController');
    return controller.getAccount(ctx);
});
```

## Consequences

### Positive

1. **Loose coupling**: Components depend on abstractions, not implementations
2. **Testability**: Easy to inject mocks and stubs for testing
3. **Lifecycle management**: Automatic singleton management
4. **Lazy loading**: Dependencies created only when needed
5. **Centralized configuration**: All wiring in one place
6. **Type safety**: Full TypeScript support with type inference
7. **Circular dependency detection**: Awilix detects and reports cycles

### Negative

1. **Magic strings**: Resolution uses string keys
2. **Runtime errors**: Dependency resolution failures happen at runtime
3. **Container coupling**: Code becomes dependent on Awilix

## Implementation

### Registration Patterns

#### Singleton Services (Most Common)
```typescript
container.register({
    accountService: asClass(AccountService).singleton()
});
```

#### Value Registration (External Dependencies)
```typescript
container.register({
    db: asValue(knex),
    config: asValue(processedConfig)
});
```

#### Factory Functions (Complex Initialization)
```typescript
container.register({
    fedify: asFunction((kv: KvStore, queue: Queue) => {
        return createFederation({ kv, queue });
    }).singleton()
});
```

#### Aliasing
```typescript
container.register({
    logging: asFunction(() => getLogger()).singleton(),
    logger: aliasTo('logging')  // Alternative name
});
```

### Testing Strategy

Tests can provide mock implementations:

```typescript
describe('AccountService', () => {
    let container: AwilixContainer;

    beforeEach(() => {
        container = createContainer();
        container.register({
            accountRepository: asValue(mockRepository),
            postService: asValue(mockPostService),
            events: asValue(new AsyncEvents()),
            logging: asValue(mockLogger)
        });
    });

    it('should create account', async () => {
        const service = container.resolve<AccountService>('accountService');
        const result = await service.createAccount(data);
        expect(result.ok).toBe(true);
    });
});
```

### Best Practices

#### 1. Interface Segregation
Define minimal interfaces for dependencies:
```typescript
interface AccountStore {
    findById(id: string): Promise<Account | null>;
    create(data: CreateData): Promise<Account>;
}
```

#### 2. Avoid Service Locator Pattern
❌ **Bad**: Passing container around
```typescript
class Service {
    constructor(private container: AwilixContainer) {
        // Anti-pattern: service locator
        this.repo = container.resolve('repository');
    }
}
```

✅ **Good**: Explicit dependencies
```typescript
class Service {
    constructor(private repository: Repository) {
        // Dependencies are explicit
    }
}
```

#### 3. Initialization Order
Services that need initialization should use an `init()` method:
```typescript
// Registration
container.register('service', asClass(Service).singleton());

// After container setup
container.resolve<Service>('service').init();
```


## References

- [Awilix Documentation](https://github.com/jeffijoe/awilix)
- [Dependency Injection in TypeScript](https://www.typescriptlang.org/docs/handbook/decorators.html)
- [SOLID Principles](https://en.wikipedia.org/wiki/SOLID)
- Current implementation: `/src/configuration/registrations.ts`
