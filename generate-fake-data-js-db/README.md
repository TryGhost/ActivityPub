# Generate Fake Data JS DB

Generate fake data by inserting directly into a MySQL database. The data can
then be dumped from the database to be imported into a different database.

## Usage

Adjust the `config.js` file to set the parameters used to control the size of the
data set that will be generated. This file also contains the database
configuration.

Adjust the `db-init.sh` script to configure the database.

### Initialise the database

```bash
./db-init.sh
```

This can also be used to reset the database as it will stop the running container
and start a new one. The data is not persisted when the container is stopped. To
enable persistence change the script to mount a directory where the data will
be persisted:

```bash
# ...
-v $(pwd)/data/mysql:/var/lib/mysql
# ...
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

```sql
SELECT "Sites", COUNT(*) FROM sites
UNION ALL
SELECT "Accounts", COUNT(*) FROM accounts
UNION ALL
SELECT "Users", COUNT(*) FROM users
UNION ALL
SELECT "Posts", COUNT(*) FROM posts
UNION ALL
SELECT "Follows", COUNT(*) FROM follows
UNION ALL
SELECT "Feeds", COUNT(*) FROM feeds
```

### Remove all generated data

```sql
SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE sites;
TRUNCATE accounts;
TRUNCATE users;
TRUNCATE posts;
TRUNCATE follows;
TRUNCATE feeds;
SET FOREIGN_KEY_CHECKS = 1;
```

### Prepare data to be exported elsewhere

```bash
./db-export.sh
```

This `mysqldump`s the database and gzips the output so it is easier to transfer.

## Notes

### Parallelisation

`generate-data.js` generates the base data in parallel in a single thread. This
works well enough as each data set is written to different tables in the
database.

`generate-follows.js` and `generate-feeds.js` generate the follows and feeds in
parallel using worker threads. The accompanying `*-worker.js` scripts contain
the logic for generating each of the data sets.

Don't run the `*-worker.js` scripts directly as they expect to be run by the
`generate-data.js` script.

If you want to debug a script without the parallelisation, edit the script and
change the `NUM_WORKERS` variable to `1`.

### Follows Generation

This script generates follows by generating a random number up to a fixed value
for each account. The value is then used to select a sample of random followers.
This works well for smaller followings, but for larger ones, we can end up
running into query limits (`Got a packet bigger than 'max_allowed_packet' bytes`)
due to the usage of multiple inserts in a single query.

### Feeds Generation

To generate a feed we need to:

- Find the ID of the account associated with a user
- Find all the accounts that follows the user's account
- Find all the posts made by followers of the user's account
- Insert into the feed each of the resolved posts

To do this we query the existing data in the database, assuming it has already
been generated.
