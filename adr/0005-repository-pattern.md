# 5. Repository Pattern for Data Access

Date: 2025-01-18

## Status

Accepted

## Context

The ActivityPub server needs to persist and query various domain entities (accounts, posts, notifications) in MySQL. Direct database access from services would create tight coupling to SQL and make testing difficult.

Key requirements:
- Abstract SQL complexity from business logic
- Enable unit testing without database
- Support transactions across operations
- Maintain type safety with TypeScript

## Decision

We will use the Repository Pattern to encapsulate all database operations, with Knex.js as the query builder.

### Repository Implementation

Each aggregate root has its own repository:

```typescript
export class KnexAccountRepository {
    constructor(private client: Knex) {}

    async getById(id: string): Promise<Account | null> {
        const row = await this.client('accounts')
            .where('id', id)
            .first();

        if (!row) return null;
        return Account.fromRow(row);
    }

    async create(data: CreateAccountData): Promise<Account> {
        const [id] = await this.client('accounts').insert({
            id: uuid(),
            username: data.username,
            name: data.name,
            created_at: new Date()
        });

        return this.getById(id)!;
    }

    async findFollowers(accountId: string, limit = 20): Promise<Account[]> {
        const rows = await this.client('follows')
            .join('accounts', 'follows.follower_id', 'accounts.id')
            .where('follows.following_id', accountId)
            .select('accounts.*')
            .limit(limit);

        return rows.map(Account.fromRow);
    }
}
```

### Service Usage

Services use repositories through dependency injection:

```typescript
export class AccountService {
    constructor(
        private accountRepository: KnexAccountRepository,
        private postRepository: KnexPostRepository
    ) {}

    async getAccountWithPosts(id: string): Promise<Result<AccountData, Error>> {
        const account = await this.accountRepository.getById(id);
        if (!account) {
            return { ok: false, error: new NotFoundError() };
        }

        const posts = await this.postRepository.findByAccount(account.id);
        return { ok: true, value: { account, posts } };
    }
}
```

### Transaction Support

Repositories accept transaction clients:

```typescript
export class PostService {
    async publishPost(data: PublishData): Promise<Result<Post, Error>> {
        return this.client.transaction(async (trx) => {
            // Create post
            const post = await this.postRepository.create(data, trx);

            // Update counters
            await this.accountRepository.incrementPostCount(
                data.accountId,
                trx
            );

            return { ok: true, value: post };
        });
    }
}
```

## Consequences

### Positive

1. **Separation of concerns**: Business logic isolated from SQL
2. **Testability**: Easy to mock repositories in tests
3. **Type safety**: Full TypeScript support for queries and results
4. **Query reuse**: Common queries defined once
5. **Migration path**: Can switch databases without changing services

### Negative

1. **Additional abstraction layer**: More code to maintain
2. **Query limitations**: Complex queries may be awkward
3. **Performance overhead**: Additional mapping layer

## Implementation

### Repository Guidelines

#### 1. One Repository Per Aggregate
```typescript
// ✅ Good: Account is the aggregate root
class KnexAccountRepository {
    async getById(id: string): Promise<Account>;
    async findFollowers(id: string): Promise<Account[]>;
}

// ❌ Bad: Mixing aggregates
class UserRepository {
    async getAccount(): Promise<Account>;
    async getPost(): Promise<Post>;
}
```

#### 2. Return Domain Entities
```typescript
// ✅ Good: Returns domain entity
async getById(id: string): Promise<Account | null> {
    const row = await this.client('accounts').where('id', id).first();
    return row ? Account.fromRow(row) : null;
}

// ❌ Bad: Returns database row
async getById(id: string): Promise<DatabaseRow> {
    return this.client('accounts').where('id', id).first();
}
```

#### 3. Accept Optional Transaction
```typescript
async create(
    data: CreateData,
    trx?: Knex.Transaction
): Promise<Account> {
    const client = trx || this.client;
    // Use client for query
}
```

### View Layer Exception

Views can bypass repositories for read-only operations:

```typescript
export class AccountView {
    constructor(private db: Knex) {}

    // Direct query for performance
    async getAccountFeed(accountId: string): Promise<FeedItem[]> {
        return this.db('posts')
            .leftJoin('likes', 'posts.id', 'likes.post_id')
            .where('posts.account_id', accountId)
            .select(
                'posts.*',
                this.db.raw('COUNT(likes.id) as like_count')
            )
            .groupBy('posts.id');
    }
}
```

## References

- [Martin Fowler: Repository Pattern](https://martinfowler.com/eaaCatalog/repository.html)
- [Domain-Driven Design](https://en.wikipedia.org/wiki/Domain-driven_design)
- Current implementation: `/src/account/account.repository.knex.ts`
