FROM fsouza/fake-gcs-server@sha256:e0dd21cc6188b8a1538cb840e29289e80c05e5ee8594ed7aa54d61cbae192517

# Install curl
RUN apk add --no-cache curl

# Copy the initialization script
COPY start.sh /start.sh
RUN chmod +x /start.sh

# Set the entrypoint
ENTRYPOINT ["/start.sh"]
