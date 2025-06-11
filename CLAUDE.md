# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Test Commands
- `yarn dev` - Start service in Docker
- `yarn test` - Run all tests (includes migrations, unit tests, integration tests, and Cucumber tests)
- `yarn test:unit` - Run unit tests
- `yarn test:integration` - Run integration tests  
- `yarn test:unit:dev` - Run unit tests in watch mode
- `yarn test:single 'src/path/to/file.test.ts'` - Run single test file
- `yarn test:cucumber` - Run Cucumber BDD tests
- `yarn lint --fix --unsafe` - Run linter and fix any easy errors
- `yarn test:types` - Run TypeScript type checker
- `yarn logs` - Follow Docker logs for the ActivityPub service
- `yarn db` - Connect to MySQL database
- `yarn migrate` - Run database migrations

## Development Workflow

- Always run the linter after making changes
- Always run the type checker after the code passes linting
- Only after the code lints and type checks can you run the tests
- Follow existing patterns, but if there are multiple patterns, stop and check for which one to use
- If the code needs to be refactored to make something work - do the refactor first without changing functionality, allowing me to commit it separately from the new/altered functionality

## Architecture Overview

This is a multitenant ActivityPub server built with Fedify and Hono. Key architectural patterns:

### Dependency Injection
- Uses Awilix for dependency injection container setup in `src/app.ts`
- Services, repositories, handlers, and dispatchers are registered as singletons
- Follow the pattern of registering dependencies in the container rather than direct imports

### Domain Structure
- **Account**: User accounts and profile management (`src/account/`)
- **Post**: Content creation and management (`src/post/`)
- **ActivityPub**: Federation protocol handlers (`src/activitypub/`)
- **Site**: Multi-tenant site management (`src/site/`)
- **Events**: Event-driven architecture with PubSub (`src/events/`)
- **HTTP API**: REST endpoints for Ghost integration (`src/http/api/`)

### Key Patterns
- **Event-Driven**: Uses domain events (e.g., `post-created.event.ts`) with AsyncEvents for decoupling
- **Repository Pattern**: Data access layer with Knex.js (e.g., `KnexAccountRepository`)
- **Handler/Dispatcher Pattern**: ActivityPub activities use handlers for incoming and dispatchers for outgoing
- **Result Pattern**: Error handling uses Result-like objects instead of exceptions
- **Context Pattern**: Fedify context carries request-scoped data including logger and database

### Database & Storage
- MySQL with Knex.js for migrations and queries
- Key-Value store for Fedify federation data
- Google Cloud Storage for media assets
- PubSub for background job processing

## Code Style
- **Formatting**: Biome with 4-space indentation, single quotes
- **Imports**: Use ES modules, organized automatically by Biome
- **Types**: Strict TypeScript with explicit typing
- **Naming**: Camel case for variables/functions, Pascal case for classes/types
- **Testing**: `.unit.test.ts` for unit tests, `.integration.test.ts` for integration tests
- **Error Handling**: Return Result-like objects instead of throwing exceptions
- **Comments**: Use comments only for non-obvious code, do not use comments to document steps, prefer to use named methods or functions to break code up

## Testing
- **Unit Tests**: Vitest for isolated component testing
- **Integration Tests**: Database and service integration testing
- **BDD Tests**: Cucumber for end-to-end feature testing
- **Snapshots**: Used for API response validation in `__snapshots__/`

## Project Structure
- `src/` - TypeScript source files organized by domain
- `features/` - Cucumber BDD test files
- `migrate/migrations/` - Database migrations
- `docker-compose.yml` - Development environment setup
- `wiremock/` - Mock external services for testing

Development environment uses Docker Compose with MySQL, PubSub emulator, and fake GCS storage.
