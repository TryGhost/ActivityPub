# Sensitive Media Display Support Progress

## 2026-07-02

- Confirmed `/Users/john/Sites/Ghost` and `/Users/john/Sites/ActivityPub` are on `main`.
- Fast-forwarded Ghost to `origin/main` while preserving pre-existing local config changes with a temporary stash.
- Confirmed ActivityPub was already up to date with `origin/main`.
- Created feature branch `codex/sensitive-media-support` in both repositories.
- Deviation: the plan asks for migration `000081_add-sensitive-media-support`, but ActivityPub `main` already contains migrations through `000082`. The implementation will use the next available migration number instead to avoid colliding with existing migrations.
- Added ActivityPub migration `000083_add-sensitive-media-support` with `posts.sensitive` and `users.show_sensitive_media`.
- Red step: `yarn test:single src/post/post.repository.knex.integration.test.ts` initially failed with `Unknown column 'sensitive' in 'field list'`.
- Deviation: MySQL treats unquoted `sensitive` as problematic in this schema context, so the migration quotes `posts.\`sensitive\`` while the runtime query builder continues to use the column name normally.
- Green step: `yarn test:single src/post/post.repository.knex.integration.test.ts` passed with 50 tests after adding repository mapping/insert/default coverage.
- Review finding: first backend slice still missed `PostService.getByApId` ingestion of ActivityPub `sensitive` and missed update persistence.
- Red step: `yarn test:single src/post/post.service.integration.test.ts` failed on two new assertions proving incoming `Note({ sensitive: true })` and `updateByApId(... sensitive: true)` both stayed `false`.
- Green step: `yarn test:single src/post/post.service.integration.test.ts` passed with 41 tests after mapping `foundObject.sensitive === true`, making `Post.sensitive` mutable through updates, comparing it in `updateByApId`, and saving it in repository updates.
- Green step: `yarn test:single src/post/post.repository.knex.integration.test.ts` passed with 50 tests after direct update persistence coverage was added.
- Quality checks: `yarn test:types` passed.
- Quality checks: `yarn lint` passed. Existing warning-only Biome output remains outside touched files (`biome.json`, `src/activitypub/fediverse-bridge.ts`, `src/http/api/views/account.follows.view.ts`, `src/site/site.service.ts`).
- Runtime/browser check: started ActivityPub with `yarn dev` and Ghost with `pnpm dev`. Ghost loaded successfully in the built-in browser at `http://localhost:2368/` with title `Ghost Dev` and heading `Thoughts, stories and ideas.`.
- Runtime deviation: the built-in browser blocked direct navigation to ActivityPub on `localhost:8080` and `127.0.0.1:8080` with `net::ERR_BLOCKED_BY_CLIENT`. ActivityPub runtime was verified by Docker health and `curl -i http://localhost:8080/`, which returned a 302 from the running service.
- Adversarial review found no blocking implementation bugs. Follow-up coverage was added for sensitive `Article` ingestion, default non-sensitive ingestion, and sensitive-only `updateByApId` change detection.
- Green step: `yarn test:single src/post/post.service.integration.test.ts` passed with 44 tests after review follow-up coverage.
- Final pre-commit checks for this slice: `yarn test:types` passed, `yarn lint` passed with the same existing warning-only output, and `git diff --check` passed.
