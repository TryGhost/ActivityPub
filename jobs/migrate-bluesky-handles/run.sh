#!/usr/bin/env bash

set -euo pipefail

PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
JOB_NAME="migrate-bluesky-handles"

REGION=$(gcloud config get-value run/region 2>/dev/null)
if [ -z "$REGION" ]; then
  REGION="us-central1"
fi

BRIDGY_ACCOUNT_ID="$1"
if [ -z "$BRIDGY_ACCOUNT_ID" ]; then
  echo "Error: bridgy account ID is required"
  exit 1
fi

echo "Executing GCP Cloud Run Job..."
echo ""
echo "Project:           $PROJECT_ID"
echo "Region:            $REGION"
echo "Job name:          $JOB_NAME"
echo "Bridgy account ID: $BRIDGY_ACCOUNT_ID"
echo ""

gcloud run jobs execute "$JOB_NAME" \
  --region "$REGION" \
  --args="$BRIDGY_ACCOUNT_ID"
