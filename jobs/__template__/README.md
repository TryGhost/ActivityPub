# __JOB_NAME__

Summary of what the job does...

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

- 
