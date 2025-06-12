# Populate Explore JSON

A Cloud Run Job that generates a JSON file containing ActivityPub profiles for
the explore page by fetching the following list from a curator account.

## Configuration

Environment variables:

- `S3_BUCKET_NAME` - S3 bucket name (default: `explore-data`)
- `S3_FILE_PATH` - Path within bucket (default: `explore/accounts.json`)
- `S3_ENDPOINT` - S3 endpoint URL (for MinIO/custom S3)
- `S3_ACCESS_KEY_ID` - S3 access key
- `S3_SECRET_ACCESS_KEY` - S3 secret key

## Local Development

```bash
# View logs
docker compose logs app

# Access MinIO console at http://localhost:9001 (minioadmin/minioadmin)
# View generated JSON at http://localhost:9000/explore-data/explore/accounts.json

# Run with file watching (auto-restart on changes)
docker compose run --rm -v $(pwd)/index.ts:/app/index.ts app tsx watch index.ts

# Check MinIO logs
docker compose logs minio

# Run with verbose output
docker compose run --rm app

# Check generated file
curl -s http://localhost:9000/explore-data/explore/accounts.json | gunzip | jq '.'
```
