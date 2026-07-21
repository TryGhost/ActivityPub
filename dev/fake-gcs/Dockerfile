FROM fsouza/fake-gcs-server@sha256:91afded49de804aa61b5f3eb6c7cd65205acf9e5c5e047cf0ba7d9507af806c8

# Install curl
RUN apk add --no-cache curl

# Copy the initialization script
COPY start.sh /start.sh
RUN chmod +x /start.sh

# Set the entrypoint
ENTRYPOINT ["/start.sh"]
