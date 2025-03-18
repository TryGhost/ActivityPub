#!/usr/bin/bash

source ./args.sh

DATA_DIR=gs://$BUCKET_NAME/csv

gsutil -m cp ./data-generation/data/gz/* $DATA_DIR

gcloud sql import csv $INSTANCE_NAME $DATA_DIR/sites.csv.gz --quiet --database=$DB_NAME --table=sites --columns=internal_id,host,webhook_secret
gcloud sql import csv $INSTANCE_NAME $DATA_DIR/accounts.csv.gz --quiet --database=$DB_NAME --table=accounts --columns=internal_id,name,username,description,icon
gcloud sql import csv $INSTANCE_NAME $DATA_DIR/users.csv.gz --quiet --database=$DB_NAME --table=users --columns=internal_id,account_id,site_id
gcloud sql import csv $INSTANCE_NAME $DATA_DIR/posts.csv.gz --quiet --database=$DB_NAME --table=posts --columns=internal_id,title,content,author_id,type

for file in $(gsutil ls $DATA_DIR | grep 'follows_.*\.csv.gz'); do
    echo "Importing $file..."

    gcloud sql import csv $INSTANCE_NAME \
        --database=$DB_NAME \
        --table=follows \
        --columns=follower_id,following_id \
        --quiet \
        "$file"
done

for file in $(gsutil ls $DATA_DIR | grep 'feeds_.*\.csv.gz'); do
    echo "Importing $file..."

    gcloud sql import csv $INSTANCE_NAME \
        --database=$DB_NAME \
        --table=feeds \
        --columns=user_id,post_id,author_id,type \
        --quiet \
        $file
done

for file in $(gsutil ls $DATA_DIR | grep 'follows_notifications_.*\.csv.gz'); do
    echo "Importing $file..."

    gcloud sql import csv $INSTANCE_NAME \
        --database=$DB_NAME \
        --table=notifications \
        --columns=user_id,account_id,event_type \
        --quiet \
        $file
done
