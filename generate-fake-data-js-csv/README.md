# Generate Fake Data JS CSV

Generate fake data by creating a series of CSV files that can be imported into
a database.

## Usage

Adjust the `config.js` file to set the parameters used to control the size of the
data set that will be generated.

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

```bash
./data-export.sh
```

This gzips the generated data files so they are easier to transfer

## Notes

### Parallelisation

`generate-data.js` generates the base data in parallel in a single thread. This
works well enough as each data set is written to disk in separate files.

`generate-follows.js` and `generate-feeds.js` generate the follows and feeds in
parallel using worker threads. The accompanying `*-worker.js` scripts contain
the logic for generating each of the data sets.

Don't run the `*-worker.js` scripts directly as they expect to be run by the
`generate-data.js` script.

If you want to debug a script without the parallelisation, edit the script and
change the `NUM_WORKERS` variable to `1`.

`generate-feeds.js` uses half the amount of workers that would technically be
available as it was found that anything more would silently crash the script.

### Follows Generation

This script generates follows by generating a random number up to a fixed value
for each account. The value is then used to select a sample of random followers.
This works well for smaller - midsize followings, but for larger ones, we can
end up generating vast amounts of data which can cause memory issues.

### Feeds Generation

To generate a feed we need to:

- Find the ID of the account associated with a user
- Find all the accounts that follows the user's account
- Find all the posts made by followers of the user's account
- Insert into the feed each of the resolved posts

Finding all of the accounts that follow a user's account is difficult because
we can't load all of the follow relationships into memory (as they are contained
in lots of large csv files), so we have to do the following:

- Open a single follows csv file at a time
- Read through each line to get the follower and following IDs
- Find the user associated with the following ID
- Find all posts made by the follower ID
- Insert into the feed

We load `users` and `posts` into memory as we need to do a lookup for each of
the follows. This works ok for the max dataset we are generating, but could be
problematic for larger datasets.
