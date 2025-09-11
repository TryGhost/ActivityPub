# Fix Reply Counts Job

One-off job to fix incorrect `reply_count` values in posts created before July 24, 2025

## Background

Due to a race condition bug (fixed in PR [#1094](https://github.com/TryGhost/ActivityPub/pull/1094)), some posts created before July 24, 2025 have incorrect `reply_count` values - showing 0 when they actually have replies

## What it does

- Finds posts created before `2025-07-24` with `reply_count = 0` that actually have replies
- Updates them with the correct count (excluding deleted replies)
- Processes in batches of 100 to avoid locking issues
- Adds delays between batches to reduce database load

## Prerequisites

- Globally available `bun`
- Globally available `docker`

## Running locally

```bash
DB_HOST=... DB_PORT=... DB_USER=... DB_PASSWORD=... DB_NAME=... bun run index.ts
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

- This job may take a while to complete so be sure to configure the job timeout to be sufficient
- The job is idempotent so it can be executed multiple times without causing issues
