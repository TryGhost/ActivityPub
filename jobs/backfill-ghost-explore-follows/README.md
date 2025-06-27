# Backfill Ghost Explore Follows

This job backfills follow activities from existing internal accounts to the Ghost Explore account.

## Purpose

When the Ghost Explore service was introduced, it automatically follows new internal accounts as they are created. However, existing accounts need to be backfilled to ensure they are also following the Ghost Explore account.

## How it works

1. Queries the database for all internal accounts (accounts with entries in the `users` table)
2. Filters out accounts that are already following the Ghost Explore account
3. Creates Follow activities and stores them in the key_value table
4. Sends Follow activities from each internal account to the Ghost Explore account with HTTP signatures
5. Processes accounts in batches to avoid overwhelming the server

## Environment Variables

- `MYSQL_HOST` - MySQL host (default: `localhost`)
- `MYSQL_PORT` - MySQL port (default: `3306`)
- `MYSQL_USER` - MySQL user (default: `root`)
- `MYSQL_PASSWORD` - MySQL password (default: `root`)
- `MYSQL_DATABASE` - MySQL database name (default: `activitypub`)
- `BATCH_SIZE` - Number of accounts to process in each batch (default: `10`)
- `MAX_CONCURRENT` - Maximum number of concurrent requests per batch (default: `5`)
- `GHOST_EXPLORE_AP_ID` - ActivityPub ID of the Ghost Explore account (default: `https://mastodon.social/users/ghostexplore`)
- `REQUEST_TIMEOUT_MS` - Timeout for HTTP requests in milliseconds (default: `30000`)

## Running the Job

### Local Development

```bash
# Install dependencies
yarn install

# Run with hot reload
yarn dev

# Or run once
yarn start
```

### Using Docker Compose

The job is integrated into the main docker-compose.yml file:

```bash
# Build and run the job (one-off execution)
docker-compose run --rm backfill-ghost-explore-follows

# Run with custom parameters
docker-compose run --rm -e BATCH_SIZE=5 -e MAX_CONCURRENT=3 backfill-ghost-explore-follows

# Run with a different Ghost Explore account
docker-compose run --rm -e GHOST_EXPLORE_AP_ID=https://example.com/users/explore backfill-ghost-explore-follows

# View logs while running
docker-compose logs -f backfill-ghost-explore-follows
```

### Production

The job should be run as a one-off task in the production environment:

```bash
# Set appropriate environment variables
export MYSQL_HOST=production-host
export MYSQL_USER=production-user
export MYSQL_PASSWORD=production-password
export MYSQL_DATABASE=production-database

# Run the job
node --import tsx index.ts
```

## Monitoring

The job logs progress information including:
- Number of accounts found that need to follow Ghost Explore
- Progress through batches
- Success/failure counts
- Total execution time

Example log output:
```
INFO [backfill-ghost-explore-follows] Starting backfill-ghost-explore-follows job
INFO [backfill-ghost-explore-follows] Found Ghost Explore account {id: 123, apId: https://mastodon.social/users/ghostexplore}
INFO [backfill-ghost-explore-follows] Found 45 internal accounts not following Ghost Explore
INFO [backfill-ghost-explore-follows] Processing batch 1/5 {batchSize: 10}
INFO [backfill-ghost-explore-follows] Successfully sent Follow activity to https://mastodon.social/inbox
INFO [backfill-ghost-explore-follows] Batch progress: 10 processed, 0 failed
INFO [backfill-ghost-explore-follows] Job completed in 12.3s {processed: 45, failed: 0, total: 45}
```

## Technical Details

### HTTP Signatures
The job uses the Web Crypto API to sign HTTP requests with RSA-SHA256 signatures. Each follow activity is signed with the sender's private key to ensure authenticity.

### Database Schema
The job interacts with these tables:
- `accounts` - Stores ActivityPub accounts
- `users` - Links internal users to accounts
- `follows` - Tracks follow relationships
- `key_value` - Stores the Follow activities

### Activity Format
Follow activities are created in the standard ActivityPub format:
```json
{
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    "https://w3id.org/security/data-integrity/v1"
  ],
  "id": "https://example.com/.ghost/activitypub/follow/uuid",
  "type": "Follow",
  "actor": "https://example.com/@username",
  "object": "https://mastodon.social/users/ghostexplore"
}
```

## Safety Features

1. **Batch Processing**: Processes accounts in small batches to avoid overwhelming the server
2. **Rate Limiting**: Adds delays between requests and batches
3. **Error Handling**: Continues processing even if individual accounts fail
4. **Idempotency**: Skips accounts that are already following Ghost Explore

## Troubleshooting

- If the job fails, check the logs for specific error messages
- Ensure the Ghost Explore account exists in the database
- Verify database connectivity and permissions
- Check that the ActivityPub endpoints are accessible
- For signature errors, verify the private keys are correctly stored in the database