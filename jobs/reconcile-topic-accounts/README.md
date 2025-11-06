# reconcile-topic-accounts

Reconciles ActivityPub accounts and topics from a data source. Ensures the database
reflects the current state of which accounts are associated with which topics

- New topics are created if they do not exist in the database
- Topics are deleted if they do not exist in the data source
- Accounts are created if they do not exist in the database
- Account-topic mappings are created if they do not exist in the database
- Account-topic mappings are deleted if they do not exist in the data source

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

- The job is idempotent and can be run multiple times safely
- Failed webfinger lookups are logged and skipped
- The items in the data source are expected to be Ghost sites, meaning we
can resolve the ActivityPub actor for the site using the webfinger lookup without
explicitly knowing the full handle (we can just use `index@domain` as there is
always only 1 account per domain and anything before the @ will always resolve to
the account for the site)
