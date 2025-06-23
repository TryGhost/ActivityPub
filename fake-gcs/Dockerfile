FROM fsouza/fake-gcs-server@sha256:d47b4cf8b87006cab8fbbecfa5f06a2a3c5722e464abddc0d107729663d40ec4

# Install curl
RUN apk add --no-cache curl

# Copy the initialization script
COPY start.sh /start.sh
RUN chmod +x /start.sh

# Set the entrypoint
ENTRYPOINT ["/start.sh"]
