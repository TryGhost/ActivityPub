# Migrate site inbox to notifications

This job migrates an `inbox` record in the `key_value` table to the
relevant `notification` records

## Prerequisites

- Globally available `gcloud` CLI

## Setup

```bash
yarn install
```

## Usage (local development)

```bash
DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=root DB_PASSWORD=secret! DB_NAME=activitypub node index.mjs example.com
```

With a limit (limit determines the number of notifications that will be created):

```bash
DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=root DB_PASSWORD=secret! DB_NAME=activitypub node index.mjs example.com 100
```

## Usage (Docker)

```bash
docker build -t migrate-site-inbox-to-notifications-job .
docker run -e DB_HOST=127.0.0.1 -e DB_PORT=3306 -e DB_USER=root -e DB_PASSWORD=secret! -e DB_NAME=activitypub migrate-site-inbox-to-notifications-job example.com
```

With a limit (limit determines the number of notifications that will be created):

```bash
docker run -e DB_HOST=127.0.0.1 -e DB_PORT=3306 -e DB_USER=root -e DB_PASSWORD=secret! -e DB_NAME=activitypub migrate-site-inbox-to-notifications-job example.com 100
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

```
DB_HOST
DB_PORT
DB_USER
DB_PASSWORD
DB_NAME
```

These need to be set manually via the UI as we do not know the db host      
and we need to retrieve the credentials from the secret manager.

1. Ensure you have logged in via `gcloud` and have the correct permissions:

```bash
gcloud auth login
```

3. Run the job:

```bash
./run.sh example.com
```

With a limit:

```bash
./run.sh example.com 100
```

## Run in GCP Manually

1. In GCP, ensure the relevant environment variables are set on the job

```
DB_HOST
DB_PORT
DB_USER
DB_PASSWORD
DB_NAME
```

2. Add an environment variable for the site host:

```
SITE_HOST
SITE_LIMIT (optional)
```

3. Trigger job execution manually via the UI
