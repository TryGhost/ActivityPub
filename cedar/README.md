# 🌳 Cedar

Cedar is a collection of tools for generating fake data and seeding a
database with it for use in testing and development.

The code is split into the following directories:

- `schema`: SQL schema for the database.
- `data-generation`: Generating fake data and seeding the database
  with it.
- `query-runner`: Running queries against the database.

## Data Generation

These commands are all run in the `data-generation` directory.

Generate fake data by creating a series of CSV files that can be
imported into a database.

Adjust the `config.js` file to set the parameters used to control the
size of the data set that will be generated.

### Install dependencies

```bash
npm install
```

### Generate base data

```bash
./run.sh node generate-data.js
```

### Generate follows

```bash
./run.sh node generate-follows.js
```

### Generate feeds

```bash
./run.sh node generate-feeds.js
```

### View how many records have been generated

```bash
./data-stats.sh
```

### Remove all generated data

```bash
./data-reset.sh
```

### Prepare data to be exported elsewhere

This compresses the generated data files to make them easier to
transfer.

**Prerequisite**: Install `pigz` on your host machine (`brew install
pigz` on macOS)

```bash
./data-export.sh
```

## Importing Data to GCP

This section guides you through setting up a Google Cloud Platform
database and importing the generated data into it.

### Prerequisites

- `gcloud` CLI configured with appropriate permissions
- Generated data files (from the steps above)

### Step 1: Set up gcloud environment

If you don't have `gcloud` set up on your host machine, use the
provided Docker container:

```bash
./gcloud.sh
```

This runs:

```bash
docker run -it --rm \
  -v $HOME/.config/gcloud:/root/.config/gcloud \
  -v $(pwd):/workspace \
  -w /workspace \
  google/cloud-sdk
```

You'll need to run `gcloud auth login` to setup your credentials the
first time.

### Step 2: Set up your GCP resources

Run the setup script to create a database, a storage bucket, upload the schema, 
and apply it to the database:

```bash
./setup.sh
```

Run this from within the gcloud Docker container if you're using the `gcloud.sh`
script noted above.

The parameters used for setting up the resources can be configured in
the `args.sh` file.

### Step 3: Generate data

Follow the instructions in the [Data Generation](#data-generation)
section above to create your data files.

### Step 4: Upload data to GCP

Upload the compressed data files to your GCP storage bucket and import them
into the database:

```bash
./upload-data.sh
```

Run this from within the gcloud Docker container if you're using the `gcloud.sh`
script noted above.

### Step 5: Run queries

After importing, you can use the query runner as described in the next
section.

## Query Runner

These commands are all run in the `query-runner` directory.

### Build Docker image

```bash
docker build . \
  -t gcr.io/ghost-activitypub/activitypub-data-generator:latest
```

### Push Docker image to GCP

```bash
docker push gcr.io/ghost-activitypub/activitypub-data-generator:latest
```

### Run Query Runner as Cloud Run Job

You can do this via the UI in the GCP Console.

### Local Testing

You can run this locally with the following commands, but a more
accurate test is to run this as a Cloud Run Job in GCP.

**Note:** For local testing, you may need to remove the platform
specification (`--platform=linux/amd64`) from the first line of the
Dockerfile.

**Prerequisite:** Ensure you have a local MySQL instance running that you
can connect to using the `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_PASSWORD`,
and `MYSQL_DATABASE` environment variables defined in commands below. The database
will need to have the schema stored in `schema` applied to it. The database will
need to have the data files generated previously imported into it.

Install dependencies:
```bash
yarn install
```

Build the local image:
```bash
docker build . -t query-runner:latest
```

Run with database connection details:
```bash
docker run --rm \ 
  -e MYSQL_HOST=<ip> \
  -e MYSQL_USER=<user> \
  -e MYSQL_PASSWORD=<pass> \
  -e MYSQL_DATABASE=activitypub_061224 \
  query-runner
```

Combined build and run command:
```bash
docker build . -t query-runner:latest && docker run --rm \
  -e MYSQL_HOST=<ip> \
  -e MYSQL_USER=<user> \
  -e MYSQL_PASSWORD=<pass> \
  -e MYSQL_DATABASE=activitypub_061224 \
  query-runner
```
