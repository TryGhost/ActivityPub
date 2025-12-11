# Development Tools and Configuration

This directory contains all development-related tools, configurations, and utilities for the ActivityPub service

## Directory Structure

### `/docker`

Contains Docker-related files and configurations for running tests and other containerized operations

- `cucumber-tests` - Docker configuration for running `cucumber` tests

### `/fake-gcs`

Mock Google Cloud Storage service for local development and testing

- Dockerfile and startup scripts for the fake GCS server
- Storage directory for persisted test data

### `/nginx`

`nginx` reverse proxy configuration for local development

- `nginx.conf` - Main `nginx` configuration
- `server.conf` - Server-specific configuration
- Dockerfile for building the `nginx` container

### `/pubsub`

Google Cloud Pub/Sub emulator configuration

- `start.sh` - Startup script for the Pub/Sub emulator

### `/wiremock`

WireMock configurations for mocking external services during testing

- `fake-ghost` - Mock Ghost instance for testing ActivityPub interactions

### `/wordpress`

WordPress ActivityPub integration testing environment

- `start.sh` - Script to start a WordPress instance with ActivityPub enabled
- Provides ephemeral WordPress environment for testing interoperability between Ghost and WordPress ActivityPub implementations
