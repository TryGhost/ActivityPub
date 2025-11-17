# backfill-ghost-uuid

Backfills the `ghost_uuid` field in the `sites` table by fetching the UUID from 
each site's `/ghost/api/admin/site/` endpoint

For each `site` in the database without a `ghost_uuid`, this job:

1. Makes a request to `https://<site_host>/ghost/api/admin/site/`
2. Extracts the `site_uuid` from the response
3. Updates the site record in the database

Sites are processed sequentially with a 500ms delay between requests to avoid 
tripping rate limits. If a request fails, the job logs a warning and continues 
to the next site

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
```

If using a socket connection, set `DB_SOCKET_PATH` instead of `DB_HOST` and `DB_PORT`

## Notes

- The job is idempotent and can be run multiple times safely
- Sites are processed sequentially to avoid tripping rate limits
- Failed requests are logged but don't stop the job from processing remaining sites
- The job is designed to be run periodically to catch any sites that failed on previous runs
