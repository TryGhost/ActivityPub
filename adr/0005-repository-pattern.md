# 5. Repository Pattern for Data Access

Date: 2025-01-18

## Status

Accepted

## Context

Direct database access from services creates tight SQL coupling and difficult testing. We need to abstract data access while maintaining type safety and transaction support.

## Decision

Implement the Repository Pattern with Knex.js to encapsulate database operations. Each aggregate root gets its own repository.

### Repository Example

```typescript
export class KnexAccountRepository {
    constructor(private client: Knex) {}

    async getById(id: string): Promise<Account | null> {
        const row = await this.client('accounts')
            .where('id', id)
            .first();
        return row ? Account.fromRow(row) : null;
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

### Service Integration

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

```typescript
export class PostService {
    async publishPost(data: PublishData): Promise<Result<Post, Error>> {
        return this.client.transaction(async (trx) => {
            const post = await this.postRepository.create(data, trx);
            await this.accountRepository.incrementPostCount(data.accountId, trx);
            return { ok: true, value: post };
        });
    }
}

// Repositories accept optional transaction
async create(data: CreateData, trx?: Knex.Transaction): Promise<Account> {
    const client = trx || this.client;
    return client('accounts').insert(data);
}
```

## Consequences

### Positive

- Business logic isolated from SQL
- Easy mocking for tests
- Query reuse and type safety
- Database migration path preserved

### Negative

- Additional abstraction layer
- Complex queries can be awkward
- Mapping overhead

## Key Guidelines

- One repository per aggregate root:
```typescript
// ✅ Good: Account is aggregate root
class KnexAccountRepository {
    async getById(id: string): Promise<Account>;
    async findFollowers(id: string): Promise<Account[]>;
}
```

- Return domain entities, not database rows
- Accept optional transaction parameter

## View Layer Exception

Views may query the database directly for performance:

```typescript
export class AccountView {
    constructor(private db: Knex) {}

    async getAccountFeed(accountId: string): Promise<FeedItem[]> {
        return this.db('posts')
            .leftJoin('likes', 'posts.id', 'likes.post_id')
            .where('posts.account_id', accountId)
            .groupBy('posts.id');
    }
}
```

## References

- [Martin Fowler: Repository Pattern](https://martinfowler.com/eaaCatalog/repository.html)
