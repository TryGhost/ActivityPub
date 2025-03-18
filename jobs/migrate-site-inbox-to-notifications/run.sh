#!/usr/bin/env bash

set -e

PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
JOB_NAME="migrate-site-inbox-to-notifications"
SITE_HOST="$1"
LIMIT="$2"

if [ -z "$PROJECT_ID" ]; then
  echo "Error: Could not determine GCP project ID"
  exit 1
fi

if [ -z "$SITE_HOST" ]; then
  echo "Error: Site host is required"
  exit 1
fi

REGION=$(gcloud config get-value run/region 2>/dev/null)
if [ -z "$REGION" ]; then
  REGION="us-central1"
fi

echo "Executing GCP Cloud Run Job..."
echo ""
echo "Project:    $PROJECT_ID"
echo "Region:     $REGION"
echo "Job name:   $JOB_NAME"
echo "Site host:  $SITE_HOST"
echo "Limit:      $LIMIT"
echo ""

gcloud run jobs execute "$JOB_NAME" \
  --region "$REGION" \
  --args="$SITE_HOST" \
  --args="$LIMIT"
