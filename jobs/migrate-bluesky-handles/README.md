# Migrate Bluesky handles

This job migrates the Bluesky handles for all accounts that follow [https://bsky.brid.gy/bsky.brid.gy](https://bsky.brid.gy/bsky.brid.gy)

## Prerequisites

- Globally available `bun`
- Globally available `gcloud` CLI
- Account for `https://bsky.brid.gy/bsky.brid.gy` exists in the database (you’ll need its account ID)

## Setup

```bash
bun install
```

## Usage (local development)

```bash
DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=root DB_PASSWORD=secret! DB_NAME=activitypub bun run index.ts 123
```

## Usage (Docker)

```bash
docker build -t migrate-bluesky-handles-job .
docker run -e DB_HOST=127.0.0.1 -e DB_PORT=3306 -e DB_USER=root -e DB_PASSWORD=secret! -e DB_NAME=activitypub migrate-bluesky-handles-job 123
```

## Deploy to GCP

1. Ensure you have logged in via `gcloud` and have the correct permissions:

```bash
gcloud auth login
gcloud auth configure-docker
```

2. Deploy the job:

```bash
./deploy.sh
```

## Run in GCP from the command line

1. In GCP, ensure the relevant environment variables are set on the job

```text
DB_HOST
DB_PORT
DB_USER
DB_PASSWORD
DB_NAME
```

These need to be set manually via the UI as we do not know the db host      
and we need to retrieve the credentials from the secret manager.

2. Ensure you have logged in via `gcloud` and have the correct permissions:

```bash
gcloud auth login
```

3. Run the job:

```bash
./run.sh <BRIDGY_ACCOUNT_ID>
```

## Run in GCP Manually

1. In GCP, ensure the relevant environment variables are set on the job

```text
DB_HOST
DB_PORT
DB_USER
DB_PASSWORD
DB_NAME
```

2. Trigger job execution manually via the UI
