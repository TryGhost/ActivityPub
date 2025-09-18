# Use Hash-based Lookups for ActivityPub IDs

## Status

Proposed

## Context

ActivityPub IDs are URLs that can be very long (500+ characters). Storing and indexing these directly in MySQL has performance implications. Additionally, case sensitivity in URLs can cause lookup issues.

## Decision

Store SHA256 hashes of ActivityPub IDs and domains for efficient lookups.

## Guidelines

**For AP ID lookups:**
```sql
WHERE ap_id_hash = UNHEX(SHA2(?, 256))
```

**For domain lookups (case-insensitive):**
```sql
WHERE domain_hash = UNHEX(SHA2(LOWER(?), 256))
```

**For inbox URL lookups (case-insensitive):**
```sql
WHERE ap_inbox_url_hash = UNHEX(SHA2(LOWER(?), 256))
```

- Always use the hash columns for lookups, never the original columns
- Hash columns are binary(32) for optimal storage
- Original values are still stored for display/reference
- Use LOWER() for case-insensitive matching

## References

- MySQL binary column indexing optimization
- SHA256 collision resistance for URL-like data