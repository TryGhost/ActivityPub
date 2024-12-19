# 🌳 Cedar

Cedar is a collection of tools for generating fake data and seeding a database
with it for use in testing and development. 

The code is split into the following directories:

  - `schema`: SQL schema for the database.
  - `data-generation`: Generating fake data and seeding the database with it.
  - `query-runner`: Running queries against the database.

## Data Generation

These commands are all run in the data-generation directory

Generate fake data by creating a series of CSV files that can be imported into a
database.

Adjust the `config.js` file to set the parameters used to control the size of
the data set that will be generated.

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

This gzips the generated data files so they are easier to transfer

```bash
./data-export.sh
```

## Query Runner

These commands are all run in the query-runner directory

### Build Docker image

```
docker build . -t gcr.io/ghost-activitypub/activitypub-data-generator:latest .
```

### Push Docker image to GCP

```
docker push gcr.io/ghost-activitypub/activitypub-data-generator:latest
```

### Run Query Runner as Cloud Run Job

You can do this via the UI in the GCP Console

### Local Testing

You can run this locally with the following commands, but a more accurate test
is to run this as a CloudRun Job in GCP. You will need to remove the platform
from the first line of the Dockerfile `--platform=linux/amd64`

```
docker build . -t query-runner:latest
```

```
docker run --rm \ 
  -e MYSQL_HOST=<ip> \
  -e MYSQL_USER=<user> \
  -e MYSQL_PASSWORD=<pass> \
  -e MYSQL_DATABASE=activitypub_061224 \
  query-runner
```

```
docker build . -t query-runner:latest && docker run --rm \
  -e MYSQL_HOST=<ip> \
  -e MYSQL_USER=<user> \
  -e MYSQL_PASSWORD=<pass> \
  -e MYSQL_DATABASE=activitypub_061224 \
  query-runner
```


