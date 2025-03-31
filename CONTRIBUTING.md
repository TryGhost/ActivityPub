# CONTRIBUTING.md

This document outlines internal development practices and conventions for our
ActivityPub project. It serves as a reference guide for our engineering team to
maintain consistency and avoid common pitfalls.

## Project Structure

This is the directory structure under `src`

```
├── account
├── post
├── site
├── feed
├── notification
├── activity-handlers # Fedify incoming Activity handlers
├── activitypub
│   └── object-dispatchers # Fedify object dispatchers
├── core
├── events
├── helpers
│   └── activitypub
├── http
│   └── api # Where all our API endpoints should be
│       └── helpers
├── mq # Implementation of a PubSub backed MessageQueue for Fedify
├── publishing
└── test # Helpers for tests
```

## Development Guidelines

This section documents quirks and conventions specific to our implementation.

### Do's

- Do model business logic in the Entities

### Don'ts

- Don't add code to dispatchers.ts
- Don't add code to handlers.ts
- Don't use the AccountType in new code
