# Enforce Repository Pattern for Data Access

## Status

Accepted

## Context

Services make direct database queries (`this.db('follows').select(...)`) instead of using repositories, violating separation of concerns.

## Decision

Services must use repositories for ALL data access. No direct database queries in services.

## Implementation

```typescript
// Repository handles all data access
class AccountRepository {
  async getFollowers(accountId: number) {
    return await this.db('follows')
      .join('accounts', 'accounts.id', 'follows.follower_id')
      .where('follows.following_id', accountId);
  }
}

// Service uses repository
class AccountService {
  constructor(private readonly accountRepository: AccountRepository) {}

  async getFollowers(accountId: number) {
    return await this.accountRepository.getFollowers(accountId);
  }
}

