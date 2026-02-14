FROM fsouza/fake-gcs-server@sha256:3730da0e31f7e5186a90ec4899dc2c336104e7599df400411392ef17e684c31f

# Install curl
RUN apk add --no-cache curl

# Copy the initialization script
COPY start.sh /start.sh
RUN chmod +x /start.sh

# Set the entrypoint
ENTRYPOINT ["/start.sh"]
