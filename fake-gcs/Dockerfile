FROM fsouza/fake-gcs-server

# Install curl
RUN apk add --no-cache curl

# Copy the initialization script
COPY start.sh /start.sh
RUN chmod +x /start.sh

# Set the entrypoint
ENTRYPOINT ["/start.sh"]
