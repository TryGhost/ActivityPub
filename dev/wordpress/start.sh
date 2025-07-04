#!/usr/bin/env bash

set -e

# Change these at your own peril 💣💣💣
WP_DEV_CONTAINER_NAME="ap-wp-dev"
WP_DEV_CONTAINER_PORT=8888
WP_DEV_DB_NAME="wordpress"
WP_DEV_DB_USER="wordpress"
WP_DEV_DB_PASSWORD="wordpress"
DOCKER_NETWORK_NAME="activitypub_default"
MYSQL_CONTAINER_NAME=$(docker ps --format "{{.Names}}" | grep 'activitypub-mysql' | head -1)
DOCKER_NETWORK_MYSQL_HOST="mysql"
DOCKER_NETWORK_MYSQL_PORT=3306

# Clean up existing wp-dev container
echo "Cleaning up existing wp-dev container..."
docker stop $WP_DEV_CONTAINER_NAME &>/dev/null || true
docker rm $WP_DEV_CONTAINER_NAME &>/dev/null || true

# Check if cloudflared is installed
if ! command -v cloudflared &>/dev/null; then
    echo "cloudflared is not installed"
    exit 1
fi

# Check if port is already in use
if lsof -Pi :$WP_DEV_CONTAINER_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "Port $WP_DEV_CONTAINER_PORT is already in use"
    exit 1
fi

# Check docker network exists
if ! docker network ls | grep -q "$DOCKER_NETWORK_NAME"; then
    echo "Docker network: $DOCKER_NETWORK_NAME not found"
    exit 1
fi

# Check mysql container exists
if ! docker ps | grep -q "$MYSQL_CONTAINER_NAME"; then
    echo "MySQL container: $MYSQL_CONTAINER_NAME not found"
    exit 1
fi

# Start cloudflared tunnel
echo "Starting Cloudflare tunnel..."
cloudflared tunnel --url http://localhost:$WP_DEV_CONTAINER_PORT >tunnel.log 2>&1 &
TUNNEL_PID=$!

# Wait for tunnel URL
echo "Waiting for tunnel URL..."
TUNNEL_URL=""
for i in {1..30}; do
    if [ -f tunnel.log ]; then
        TUNNEL_URL=$(grep -o 'https://[^[:space:]]*\.trycloudflare\.com' tunnel.log | head -1)
        if [ ! -z "$TUNNEL_URL" ]; then
            break
        fi
    fi
    sleep 1
done

if [ -z "$TUNNEL_URL" ]; then
    echo "Failed to get tunnel URL"
    kill $TUNNEL_PID 2>/dev/null
    exit 1
fi

echo "Tunnel URL: $TUNNEL_URL"

# Ensure WordPress database exists
echo "Setting up WordPress database..."
docker exec $MYSQL_CONTAINER_NAME mysql -uroot -proot -e "
    DROP DATABASE IF EXISTS $WP_DEV_DB_NAME;
    CREATE DATABASE $WP_DEV_DB_NAME;

    -- Drop user if exists (to handle re-runs)
    DROP USER IF EXISTS '$WP_DEV_DB_USER'@'%';

    -- Create user
    CREATE USER '$WP_DEV_DB_USER'@'%' IDENTIFIED BY '$WP_DEV_DB_PASSWORD';

    -- Grant privileges
    GRANT ALL PRIVILEGES ON $WP_DEV_DB_NAME.* TO '$WP_DEV_DB_USER'@'%';

    -- Apply changes
    FLUSH PRIVILEGES;
" 2>/dev/null || echo "Database setup completed"

# Start WordPress container
echo "Starting WordPress container..."
docker run -d \
    --name $WP_DEV_CONTAINER_NAME \
    --network $DOCKER_NETWORK_NAME \
    -p $WP_DEV_CONTAINER_PORT:80 \
    -e WORDPRESS_DB_HOST=$DOCKER_NETWORK_MYSQL_HOST:$DOCKER_NETWORK_MYSQL_PORT \
    -e WORDPRESS_DB_USER=$WP_DEV_DB_USER \
    -e WORDPRESS_DB_PASSWORD=$WP_DEV_DB_PASSWORD \
    -e WORDPRESS_DB_NAME=$WP_DEV_DB_NAME \
    -e WORDPRESS_TABLE_PREFIX=wp_ \
    -e WORDPRESS_DEBUG=1 \
    -e WORDPRESS_CONFIG_EXTRA="
define('WP_HOME', '${TUNNEL_URL}');
define('WP_SITEURL', '${TUNNEL_URL}');
define('FORCE_SSL_ADMIN', true);
define('WP_DEBUG_LOG', true);
define('WP_DEBUG_DISPLAY', false);

// Disable WordPress fatal error handler emails
define('WP_DISABLE_FATAL_ERROR_HANDLER', true);

// Handle reverse proxy
if (!empty(\$_SERVER['HTTP_X_FORWARDED_PROTO']) && \$_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https') {
    \$_SERVER['HTTPS'] = 'on';
}
if (!empty(\$_SERVER['HTTP_X_FORWARDED_HOST'])) {
    \$_SERVER['HTTP_HOST'] = \$_SERVER['HTTP_X_FORWARDED_HOST'];
}
" \
    wordpress:6.7-php8.3-apache \
    &>/dev/null

# Wait for WordPress to be ready
echo "Waiting for WordPress to start..."
for i in {1..30}; do
    if curl -s -o /dev/null -w "%{http_code}" http://localhost:$WP_DEV_CONTAINER_PORT | grep -q "200\|302"; then
        echo "WordPress is ready!"
        break
    fi
    sleep 1
done

# Install WP-CLI in the container
echo "Installing WP-CLI..."
docker exec $WP_DEV_CONTAINER_NAME bash -c "
    curl -sO https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar &&
    chmod +x wp-cli.phar &&
    mv wp-cli.phar /usr/local/bin/wp
"

# Install WordPress
echo "Installing WordPress..."
docker exec $WP_DEV_CONTAINER_NAME wp core install \
    --url="$TUNNEL_URL" \
    --title="WordPress ActivityPub Test" \
    --admin_user="admin" \
    --admin_password="password" \
    --admin_email="admin@example.com" \
    --skip-email \
    --allow-root

# Install plugins
echo "Installing ActivityPub plugin..."
docker exec $WP_DEV_CONTAINER_NAME wp plugin install activitypub --activate --allow-root --quiet 2>/dev/null && echo "ActivityPub plugin installed"

echo "Installing Friends plugin..."
docker exec $WP_DEV_CONTAINER_NAME wp plugin install friends --activate --allow-root --quiet 2>/dev/null && echo "Friends plugin installed"

# Configure ActivityPub settings
echo "Configuring ActivityPub settings..."
docker exec $WP_DEV_CONTAINER_NAME wp option update activitypub_actor_mode "actor_blog" --allow-root
docker exec $WP_DEV_CONTAINER_NAME wp option update activitypub_blog_identifier "blog" --allow-root

# Create test authors
echo "Creating test authors..."
docker exec $WP_DEV_CONTAINER_NAME wp user create alice alice@example.com --role=author --user_pass=password --display_name="Alice" --allow-root
docker exec $WP_DEV_CONTAINER_NAME wp user create bob bob@example.com --role=author --user_pass=password --display_name="Bob" --allow-root
docker exec $WP_DEV_CONTAINER_NAME wp user create charlie charlie@example.com --role=author --user_pass=password --display_name="Charlie" --allow-root

# Set up permalinks
echo "Setting up permalinks..."
docker exec $WP_DEV_CONTAINER_NAME wp rewrite structure '/%postname%/' --allow-root
docker exec $WP_DEV_CONTAINER_NAME wp rewrite flush --allow-root

# Create a test post
echo "Creating test post..."
docker exec $WP_DEV_CONTAINER_NAME wp post create \
    --post_title="Hello from WordPress ActivityPub!" \
    --post_content="This is a test post from WordPress with ActivityPub enabled. You can follow this blog at @blog@${TUNNEL_URL#https://}" \
    --post_status=publish \
    --allow-root

echo ""
echo "========================================================================="
echo ""
echo "WordPress is running at:"
echo ""
echo "  $TUNNEL_URL"
echo ""
echo "Admin login:"
echo ""
echo "  $TUNNEL_URL/wp-admin"
echo ""
echo "Users (all passwords are 'password'):"
echo ""
echo "  admin, alice, bob, charlie"
echo ""
echo "ActivityPub handles:"
echo "  Blog:    @blog@${TUNNEL_URL#https://}"
echo "  Admin:   @admin@${TUNNEL_URL#https://}"
echo "  Alice:   @alice@${TUNNEL_URL#https://}"
echo "  Bob:     @bob@${TUNNEL_URL#https://}"
echo "  Charlie: @charlie@${TUNNEL_URL#https://}"
echo ""
echo "========================================================================="
echo ""
echo "Press Ctrl+C to stop WordPress and the tunnel"
echo ""
echo "Tunnel Logs:"
echo ""

# Cleanup
cleanup() {
    echo ""
    echo "Stopping..."
    docker stop $WP_DEV_CONTAINER_NAME &>/dev/null
    docker rm $WP_DEV_CONTAINER_NAME &>/dev/null
    kill $TUNNEL_PID 2>/dev/null
    exit 0
}

trap cleanup INT TERM

# Keep the script running
tail -f tunnel.log
