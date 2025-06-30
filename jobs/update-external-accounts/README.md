# Update External Accounts

This job updates existing external ActivityPub accounts with latest information from their ActivityPub endpoints.

## Purpose

We have outdated and missing data for external accounts in our database because we previously didn't support Update activities. Now that we have implemented Update activity support, this one-time job updates all existing external accounts with latest account information.

## How it works

1. **Pagination**: Queries the database for external accounts (accounts with no entries in the `users` table) in chunks to avoid memory issues
2. **Rate Limiting**: Processes accounts with controlled concurrency using a rate limiter to be respectful to external servers
3. **Parallel Processing**: Uses parallel requests with configurable concurrency limits
4. **Account Fetching**: For each account, fetches current ActivityPub information from their endpoint
5. **Database Updates**: Updates account information in the database with fresh data

## Environment Variables

### Database Configuration
- `MYSQL_HOST` - MySQL host (default: `localhost`)
- `MYSQL_PORT` - MySQL port (default: `3306`)
- `MYSQL_USER` - MySQL user (default: `root`)
- `MYSQL_PASSWORD` - MySQL password (default: `root`)
- `MYSQL_DATABASE` - MySQL database name (default: `activitypub`)

### Processing Configuration
- `BATCH_SIZE` - Number of accounts to fetch and process in each chunk (default: `100`)
- `MAX_CONCURRENT` - Maximum number of concurrent requests (default: `10`)
- `CONCURRENT_DELAY_MS` - Delay between individual requests in milliseconds (default: `50`)
- `BATCH_DELAY_MS` - Delay between chunks in milliseconds (default: `1000`)
- `REQUEST_TIMEOUT_MS` - Timeout for HTTP requests in milliseconds (default: `30000`)

## Performance Configuration

### Settings for Production (~ 133,362 accounts)

```bash
BATCH_SIZE=1000
MAX_CONCURRENT=10
CONCURRENT_DELAY_MS=50
BATCH_DELAY_MS=1000
REQUEST_TIMEOUT_MS=30000
```

**Estimated completion time**: ~1.34 hours (80 minutes) for 133,362 accounts

## Running the Job

### Using Docker Compose

The job is integrated into the main docker-compose.yml file:

```bash
# Build and run the job (one-off execution)
docker-compose build update-external-accounts
docker-compose run --rm update-external-accounts

# Run with custom parameters
docker-compose run --rm -e BATCH_SIZE=1000 -e MAX_CONCURRENT=10 update-external-accounts
```

### Production

The job should be run as a one-off task in the production environment:

```bash
# Set appropriate environment variables
export MYSQL_HOST=production-host
export MYSQL_USER=production-user
export MYSQL_PASSWORD=production-password
export MYSQL_DATABASE=production-database

# Set production configuration
export BATCH_SIZE=1000
export MAX_CONCURRENT=10
export CONCURRENT_DELAY_MS=50
export BATCH_DELAY_MS=1000
export REQUEST_TIMEOUT_MS=30000

# Run the job
node --import tsx index.ts
```

## Monitoring

The job provides detailed logging including:
- Total number of external accounts found
- Progress through chunks
- Individual account processing status
- Success/failure counts
- Total execution time

Example log output:
```
{"severity":"INFO","timestamp":"2025-06-30T06:08:42.160Z","message":"Updated external account 354 with fresh information","accountId":354,"name":"rfe","bio":"","avatarUrl":null,"bannerImageUrl":null,"url":"https://avision-it.social/@rfe","custom_fields":null}
{"severity":"WARNING","timestamp":"2025-06-30T06:08:42.755Z","message":"Account not accessible: https://mastodon.social/users/JamieRadJon - HTTP 410","apId":"https://mastodon.social/users/JamieRadJon","status":410}
{"severity":"WARNING","timestamp":"2025-06-30T06:08:42.755Z","message":"Skipping account: https://mastodon.social/users/JamieRadJon","apId":"https://mastodon.social/users/JamieRadJon"}
{"severity":"INFO","timestamp":"2025-06-30T06:08:42.756Z","message":"=== JOB COMPLETED === Total: 398 | Processed: 24 | Failed: 0 | Skipped: 374 | Duration: 13.1s","total":398,"processed":24,"failed":0,"skipped":374,"duration":"13.1"}
```

## Technical Details

### Rate Limiting
The job uses a custom rate limiter that:
- Maintains a maximum number of concurrent requests
- Queues additional requests when the limit is reached
- Releases slots as requests complete
- Ensures respectful load on external ActivityPub servers

### Pagination
- Fetches accounts in configurable chunks to avoid memory issues
- Uses database offset/limit for efficient querying
- Processes large datasets without loading everything into memory

### Database Connection Pool
Optimized connection pool settings for concurrent processing:
- Minimum 5 connections, maximum 20
- 60-second acquire timeout
- 30-second create timeout
- Automatic cleanup of idle connections

### ActivityPub Integration
- Fetches account information using ActivityPub endpoints
- Parses JSON-LD responses using Fedify library
- Extracts profile information, avatars, banners, and custom fields

### Database Schema
The job interacts with these tables:
- `accounts` - Stores ActivityPub accounts
- `users` - Links internal users to accounts (used to identify external accounts)

## Safety Features

1. **Pagination**: Processes accounts in chunks to avoid memory issues
2. **Rate Limiting**: Controls concurrency to be respectful to external servers
3. **Error Handling**: Continues processing even if individual accounts fail
4. **Timeout Protection**: HTTP requests timeout after configurable duration
5. **Graceful Degradation**: Skips accounts that are inaccessible or return errors
6. **Database Connection Management**: Proper connection pooling and cleanup

## Troubleshooting

### Common Issues

- **Rate Limiting**: If external servers return 429 errors, reduce `MAX_CONCURRENT` or increase `CONCURRENT_DELAY_MS`
- **Memory Issues**: If the job runs out of memory, reduce `BATCH_SIZE`
- **Database Connection Errors**: Check connection pool settings and database availability
- **Timeout Errors**: Increase `REQUEST_TIMEOUT_MS` for slow external servers

### Debugging

- Check logs for specific error messages
- Verify database connectivity and permissions
- Ensure ActivityPub endpoints are accessible
- Monitor external server response times
- Check for network connectivity issues

### Performance Tuning

- **Too Slow**: Increase `MAX_CONCURRENT` or decrease delays
- **Too Aggressive**: Decrease `MAX_CONCURRENT` or increase delays
- **Memory Issues**: Decrease `BATCH_SIZE`
- **Database Load**: Increase `BATCH_DELAY_MS`