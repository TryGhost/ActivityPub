# Use View Pattern for Read Operations

## Status

Proposed

## Context

Services need to return data optimized for API responses with:
- Complex aggregations (post counts, follower counts)
- User-specific context (followedByMe, blockedByMe)
- Multiple joins across tables
- Presentation-ready formatting

Using repositories for these operations would require either:
1. Multiple repository calls followed by in-memory aggregation (N+1 queries)
2. Complex repository methods that break the abstraction

## Decision

Use dedicated View classes for read-heavy operations that return presentation data.

## Implementation

```typescript
// Views can query DB directly for read optimization
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