FROM fsouza/fake-gcs-server@sha256:666f86b873120818b10a5e68d99401422fcf8b00c1f27fe89599c35236f48b4c

# Install curl
RUN apk add --no-cache curl

# Copy the initialization script
COPY start.sh /start.sh
RUN chmod +x /start.sh

# Set the entrypoint
ENTRYPOINT ["/start.sh"]
