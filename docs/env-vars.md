# Environment Variables

This ActivityPub service uses a variety of environment variables to configure its behaviour

<p>
    * = Required
    <br />
    ^ = Conditionally required
</p>

## Service Configuration

- `NODE_ENV`* - The Node environment the service will run in (`development`, `testing`, `production`)
  - This env var is required and should be set to `production` in a production environment
- `PORT` - The port the service will run on
  - If not set, a default of `8080` will be used
- `ALLOW_PRIVATE_ADDRESS` - Set to `true` to allow connections to private IP addresses
  - This is only used in `development` and `testing` environments
  - See [https://fedify.dev/manual/federation#allowprivateaddress](https://fedify.dev/manual/federation#allowprivateaddress) for more details
- `SKIP_SIGNATURE_VERIFICATION` - Set to `true` to skip ActivityPub signature verification
  - This is only used in `development` and `testing` environments
  - See [https://github.com/fedify-dev/fedify/issues/110](https://github.com/fedify-dev/fedify/issues/110) for more details
- `ACTIVITYPUB_COLLECTION_PAGE_SIZE`* - Set the number of items to return per page for an ActivityPub collection
  - This used by the `outbox` and `following` collections
- `FEDIFY_KV_STORE_TYPE` - Set to `redis` to use Redis as the [key-value store for Fedify](https://fedify.dev/manual/kv)
  - If not set, MySQL will be used
- `USE_MQ` - Set to `true` to enable message queue usage
  - See [https://fedify.dev/manual/mq](https://fedify.dev/manual/mq) for more details
- `MANUALLY_START_QUEUE` - Set to `true` to manually start the message queue
  - This is only used if `USE_MQ` is set to `true`
  - See [https://fedify.dev/manual/federation#manuallystartqueue](https://fedify.dev/manual/federation#manuallystartqueue) for more details
- `GHOST_PRO_IP_ADDRESSES` - Comma-separated list of Ghost Pro IP addresses used to identify requests from Ghost Pro
- `ACTIVITYPUB_SURROGATE_CACHE_CONTROL` - Custom Surrogate-Control header value for caching of content
  - Only used in `production` environments with a CDN (i.e Fastly)
  - Example: `max-age=60, stale-while-revalidate=300, stale-if-error=0`
- `FORCE_INTERNAL_ACTIVITY_DELIVERY` - Set to `true` to force internal activities to be delivered via the Fediverse

## Database Configuration

- `MYSQL_HOST`^ - MySQL database host
  - Only used if `MYSQL_SOCKET_PATH` is not set
- `MYSQL_PORT`^ - MySQL database port
  - Only used if `MYSQL_SOCKET_PATH` is not set
- `MYSQL_SOCKET_PATH`^ - MySQL Unix socket path
  - Only used if `MYSQL_HOST` and `MYSQL_PORT` are not set
- `MYSQL_USER`* - MySQL database username
- `MYSQL_PASSWORD`* - MySQL database password
- `MYSQL_DATABASE`* - MySQL database name
- `MYSQL_CONN_POOL_MIN` - Minimum number of connections in the MySQL connection pool
  - Default: `1`
- `MYSQL_CONN_POOL_MAX` - Maximum number of connections in the MySQL connection pool
  - Default: `200`
- `MYSQL_CONN_POOL_ACQUIRE_TIMEOUT` - Timeout in milliseconds for acquiring a connection from the pool
  - Default: `30000` (30 seconds)
- `MYSQL_CONN_POOL_CREATE_TIMEOUT` - Timeout in milliseconds for creating a new connection
  - Default: `30000` (30 seconds)
- `MYSQL_CONN_POOL_DESTROY_TIMEOUT` - Timeout in milliseconds for destroying a connection
  - Default: `5000` (5 seconds)
- `MYSQL_CONN_POOL_IDLE_TIMEOUT` - Time in milliseconds before idle connections are destroyed
  - Default: `30000` (30 seconds)
- `MYSQL_CONN_POOL_REAP_INTERVAL` - How often in milliseconds to check for idle connections to destroy
  - Default: `1000` (1 second)
- `MYSQL_CONN_POOL_CREATE_RETRY_INTERVAL` - Time in milliseconds to wait before retrying a failed connection create
  - Default: `200` (200 milliseconds)

## Redis Configuration

Only required if `FEDIFY_KV_STORE_TYPE` is set to `redis`

- `REDIS_HOST` - Redis server host
- `REDIS_PORT` - Redis server port
- `REDIS_TLS_CERT` - TLS certificate for Redis connection
  - Only required if Redis is configured to use TLS

## Message Queue Configuration

Only required if `USE_MQ` is set to `true`

Only Google Cloud Pub/Sub is supported at the moment

- `MQ_PUBSUB_PROJECT_ID` - Google Cloud Pub/Sub project ID
- `MQ_PUBSUB_HOST` - Google Cloud Pub/Sub host address
- `MQ_PUBSUB_TOPIC_NAME` - Topic name for Fedify-specific messages
- `MQ_PUBSUB_GHOST_TOPIC_NAME` - Topic name for Ghost-specific messages
- `MQ_PUBSUB_USE_RETRY_TOPIC` - Set to `true` to use a retry topic
  - If not set, messages will still be retried using GCP's exponential backoff
- `MQ_PUBSUB_RETRY_TOPIC_NAME` - Topic name for retry messages
  - Only used if `MQ_PUBSUB_USE_RETRY_TOPIC` is set to `true`
- `MQ_PUBSUB_MAX_DELIVERY_ATTEMPTS` - Maximum delivery attempts to the retry topic before giving up
  - Only used if `MQ_PUBSUB_USE_RETRY_TOPIC` is set to `true`
  - Default is `Infinity` (i.e. no maximum)

## Storage Configuration

Data (i.e image uploads) can either be stored in Google Cloud Storage or locally

If using Google Cloud Storage:

- `GCP_BUCKET_NAME`^ - Google Cloud Storage bucket name
- `GCP_STORAGE_EMULATOR_HOST`^ - Google Cloud Storage emulator host URL
  - Only used in `development` and `testing` environments
- `GCS_LOCAL_STORAGE_HOSTING_URL`^ - Public URL for accessing stored files
  - Only used in `development` and `testing` environments

If using local storage:

- `LOCAL_STORAGE_PATH`^ - Path for storing files locally
- `LOCAL_STORAGE_HOSTING_URL`^ - Public URL for accessing stored (local) files

## Logging & Monitoring

- `LOG_LEVEL` - Global log level for all loggers
- `LOG_LEVEL_ACTIVITYPUB` - Log level specifically for ActivityPub service logs (overrides `LOG_LEVEL`)
  - Valid values: `debug`, `info`, `warning`, `error`
  - If not set, and `LOG_LEVEL` is not set, the level will be set to `info`
- `LOG_LEVEL_FEDIFY` - Log level specifically for Fedify library logs (overrides `LOG_LEVEL`)
  - Valid values: `debug`, `info`, `warning`, `error`
  - If not set, and `LOG_LEVEL` is not set, the level will be set to `warning`

## Observability & Tracing

- `SENTRY_DSN` - Sentry Data Source Name for error tracking
- `OTEL_DEBUG_LOGGING` - Set to `true` to enable OpenTelemetry debug logging
  - This is only used in `production` environments
- `ENABLE_CPU_PROFILER` - Set to `true` to enable Google Cloud CPU profiling
