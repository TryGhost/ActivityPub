FROM fsouza/fake-gcs-server@sha256:4957e37e252c8720cf861eb14e0b5aa671845e833c49285a45465ec7fa24e981

# Install curl
RUN apk add --no-cache curl

# Copy the initialization script
COPY start.sh /start.sh
RUN chmod +x /start.sh

# Set the entrypoint
ENTRYPOINT ["/start.sh"]
