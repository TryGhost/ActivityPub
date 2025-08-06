# ActivityPub Service Frontend Versioning via Backend Configuration

## Status

Proposed

## Context

We have an ActivityPub service with multiple deployment scenarios that creates version compatibility challenges:

**Current Architecture:**
- ActivityPub frontend is dynamically imported as a JS bundle into Ghost Admin
- Frontend bundle is served from jsDelivr CDN
- Backend API has versioned endpoints (`/activitypub/v1/*`)

**Deployment Scenarios:**
1. **Ghost Pro hosted**: Users always run the latest backend and frontend versions
2. **Self-hosted with proxy**: Users proxy to our infrastructure (latest backend) but may have older Ghost versions (older frontend loader)
3. **Self-hosted with Docker**: Users run specific backend versions in Docker containers and may have older Ghost versions

**Problem:**
When we make breaking changes to the backend API, we risk breaking functionality for users who have mismatched frontend/backend versions. Currently, the frontend version is determined by the Ghost version, which may not match the backend version being used (especially for self-hosted users proxying to our infrastructure or running older Docker containers).

**Constraints:**
- We cannot dynamically configure client-side built code with environment variables
- We want to avoid maintaining multiple API versions in the same codebase (e.g., `/v1`, `/v2` code duplication)
- We want to minimize infrastructure costs (running multiple backend versions is wasteful)
- The JS bundle loader that imports the frontend is already deployed and cached on various Ghost installations

## Decision

Implement a backend-driven frontend configuration endpoint that tells the JS bundle loader which frontend version to load.

**Implementation:**
1. Add a new endpoint: `/.ghost/activitypub/client-config` (or alternative names: `/frontend-config`, `/bundle-info`)
2. This endpoint returns the CDN URL for the frontend version that is compatible with the backend:
   ```json
   {
     "bundleUrl": "https://cdn.jsdelivr.net/ghost/admin-x-activitypub@1/dist/admin-x-activitypub.js"
   }
   ```
3. The JS bundle loader:
   - Calls this configuration endpoint when initializing
   - Dynamically imports the JS bundle from the URL provided by the backend
   - Uses the imported bundle to render the frontend

**Version Matching:**
- Backend versions will typically pin to major versions (e.g., backend v1.x.x → frontend @1)
- This ensures compatibility while allowing patch and minor updates
- Backend can specify exact versions when necessary for critical fixes

**Release Process:**
- Backend can be deployed continuously
- Only when the backend needs to change its required frontend version does the frontend need to be published first
- This is an infrequent operation tied to breaking changes

## Consequences

**Positive:**
- **Guaranteed compatibility**: Frontend and backend versions are always compatible, eliminating version mismatch issues
- **Simple mental model**: Each backend version declares which frontend it works with
- **No code duplication**: No need to maintain multiple API versions in the codebase
- **Minimal changes**: Only need to add one endpoint and update the JS loader
- **Flexible versioning**: Can pin to major versions for stability or specific versions when needed
- **Self-contained**: Each deployment scenario works independently without special cases

**Negative:**
- **Additional HTTP request**: The loader must make a request to get the bundle URL before importing (minimal latency impact)
- **CDN dependency**: Requires frontend versions to remain available on CDN (already true for current architecture)
- **Coordinated releases**: When making breaking changes, frontend must be published before backend can require it

**Neutral:**
- Self-hosted users with Docker containers will need to update their containers to get new features (already true, just makes the coupling explicit)
- Users cannot mix and match incompatible frontend/backend versions (this is intentional for stability)
