# Contributing to ActivityPub Service

## Development Guidelines

For architectural patterns, code standards, and development guidelines, please see the [Architecture & Development Guidelines](README.md#️-architecture--development-guidelines) section in the main README.

## Submitting Changes

1. Create a feature branch from `main`
2. Make your changes following the patterns documented in README
3. Ensure tests pass: `yarn test`
4. Submit a pull request with a clear description

## Code Review Process

- All PRs require at least one review
- Check that new code follows our architectural patterns (see ADRs)
- Ensure proper error handling with Result types
- Verify no direct database queries in services
- Don't use the AccountType in new code
