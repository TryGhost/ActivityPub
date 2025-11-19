# reconcile-account-topics

Reconciles ActivityPub accounts with topics from the database using an external
API as the source of truth

For each topic in the database:
- Fetches up to 200 sites from an external API endpoint
- Creates accounts for sites that don't exist in the database
- Creates account-topic mappings for sites returned by the API
- Deletes account-topic mappings for sites no longer returned by the API

**Note**: Topics are NOT created or deleted by this job - they must already exist in the database

## Prerequisites

- Globally available `bun`
- Globally available `docker`

## Running locally

```bash
DB_HOST=... \
DB_PORT=... \
DB_USER=... \
DB_PASSWORD=... \
DB_NAME=... \
SITES_API_ENDPOINT=... \
SITES_API_AUTH_TOKEN=... \
bun run index.ts
```

## Running tests

```bash
./run-tests.sh
```

## Production deployment

Build and push the Docker image to GCP:

```bash
./gcloud-push.sh
```

## Production execution

Use the [GCP console](https://console.cloud.google.com/run/jobs/create) to setup and execute the job

Ensure the relevant environment variables are set on the job:

```text
DB_HOST
DB_PORT
DB_USER
DB_PASSWORD
DB_NAME
SITES_API_ENDPOINT
SITES_API_AUTH_TOKEN
```

If using a socket connection, set `DB_SOCKET_PATH` instead of `DB_HOST` and `DB_PORT`

`SITES_API_ENDPOINT` should be the full URL to the sites API endpoint (e.g., `https://example.com/api/sites`)

`SITES_API_AUTH_TOKEN` is required in production for authenticating with the sites API

## Notes

- The job is idempotent and can be run multiple times safely
- Failed API requests for a topic are logged and skipped (other topics continue processing)
- Failed webfinger lookups are logged and skipped
- Sites are expected to be Ghost sites, meaning we can resolve the ActivityPub actor
  using `index@domain` as the webfinger handle (Ghost has only 1 account per domain
  and any username resolves to the site account)
- Topics must be pre-populated in the database before running this job
- The job processes topics sequentially, but this could be parallelized for better performance
