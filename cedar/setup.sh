#!/bin/sh

source ./args.sh

gcloud sql instances create $INSTANCE_NAME \
  --database-version=MYSQL_8_0 \
  --tier=$TIER \
  --region=$REGION \
  --root-password="a-very-secure-password"

gcloud sql databases create $DB_NAME --instance=$INSTANCE_NAME

gcloud sql users create test_user \
  --instance=$INSTANCE_NAME \
  --password="a-very-secure-password"

gsutil mb -l us-central1 gs://$BUCKET_NAME

gsutil -m cp ./schema/tables.sql gs://$BUCKET_NAME/sql/
gsutil -m cp ./schema/indexes.sql gs://$BUCKET_NAME/sql/

# Give the SQL service account read perms on the bucket
CLOUDSQL_SA=$(gcloud sql instances describe $INSTANCE_NAME --format='value(serviceAccountEmailAddress)')
gsutil iam ch serviceAccount:$CLOUDSQL_SA:objectViewer gs://$BUCKET_NAME

gcloud sql import sql $INSTANCE_NAME gs://$BUCKET_NAME/sql/tables.sql --database=$DB_NAME
gcloud sql import sql $INSTANCE_NAME gs://$BUCKET_NAME/sql/indexes.sql --database=$DB_NAME
