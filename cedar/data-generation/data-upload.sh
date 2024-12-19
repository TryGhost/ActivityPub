#!/usr/bin/env bash

set -e

INSTANCE=scale-testing-daniel-2
DATABASE=activitypub

FOLDER=${GENERATED_DIR:-generated_2024-12-11_12-51-35}
DATA_DIR=gs://scale-testing-data/$FOLDER

gcloud sql import csv $INSTANCE $DATA_DIR/sites.csv --quiet --database=$DATABASE --table=sites --columns=internal_id,host,webhook_secret
gcloud sql import csv $INSTANCE $DATA_DIR/accounts.csv --quiet --database=$DATABASE --table=accounts --columns=internal_id,name,username,description,icon
gcloud sql import csv $INSTANCE $DATA_DIR/users.csv --quiet --database=$DATABASE --table=users --columns=internal_id,account_id,site_id
gcloud sql import csv $INSTANCE $DATA_DIR/posts.csv --quiet --database=$DATABASE --table=posts --columns=internal_id,title,content,author_id,type

for file in $(gsutil ls $DATA_DIR | grep 'follows_.*\.csv'); do
    echo "Importing $file..."

    gcloud sql import csv $INSTANCE \
        --database=$DATABASE \
        --table=follows \
        --columns=follower_id,following_id \
        --quiet \
        "$file"
done

for file in $(gsutil ls $DATA_DIR | grep 'feeds_.*\.csv'); do
    echo "Importing $file..."

    gcloud sql import csv $INSTANCE \
        --database=$DATABASE \
        --table=feeds \
        --columns=user_id,post_id,author_id,type \
        --quiet \
        $file
done
