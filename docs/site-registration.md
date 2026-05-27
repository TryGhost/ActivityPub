# Site Registration

Site registration is the process by which a Ghost site connects to
the ActivityPub service

## Registration Flow

1. Ghost site sends a `POST` request to `/.ghost/activitypub/v1/site`
   - This happens when a Ghost site is booted
2. Service checks if site already exists for the `host` of the request
   - If exists, returns existing site (idempotent)
   - If not, proceeds to create new site
3. Service fetches site settings from Ghost to get `ghost_uuid` (called `site_uuid` in Ghost)
4. Service handles `ghost_uuid` uniqueness (see below)
5. Service creates new site record with the `ghost_uuid`
6. Service creates internal account for the site

## Duplicate ghost_uuid Handling

The `ghost_uuid` column on `sites` has a UNIQUE constraint. When a new
host registers with a `ghost_uuid` that already belongs to an existing
site row, the service classifies the previous owner's current state by
fetching `/ghost/api/admin/site/` on the previous host:

| Previous host response                              | Classification         | Outcome                                |
| --------------------------------------------------- | ---------------------- | -------------------------------------- |
| 200 with the same `site_uuid`                       | `still-claims`         | Refuse the reassignment                |
| 200 with a different / missing `site_uuid`          | `released`             | Allow reassignment                     |
| 200 with non-JSON body                              | `released`             | Allow reassignment                     |
| 3xx / 4xx                                           | `released`             | Allow reassignment                     |
| DNS NXDOMAIN (ENOTFOUND)                            | `released`             | Allow reassignment                     |
| Connection refused (ECONNREFUSED)                   | `released`             | Allow reassignment                     |
| Transient DNS failure (EAI_AGAIN)                   | `unverifiable`         | Allow reassignment (fail-open), logged |
| 5xx / timeout / other transport error               | `unverifiable`         | Allow reassignment (fail-open), logged |

When the reassignment proceeds (whether `released` or `unverifiable`),
the previous row's `ghost_uuid` is set to `null` and the new row takes
the UUID. The previous row's account data stays intact; only the UUID
claim is released.

### Fail-open on unverifiable

For genuinely ambiguous responses (5xx, timeout, TLS errors), the
service allows the reassignment rather than refuse it. This prevents
transient outages on the previous host from blocking legitimate domain
changes. Reassignments classified as `unverifiable` are logged at warn
level so the pattern is observable in logs.

### Trust model

This verification is best-effort against the previous host itself. It
catches the case where a live, registered host actively serves a
conflicting UUID. It does not authoritatively prove ownership and does
not defend against:

- A registration claiming a `ghost_uuid` that AP has never seen before
  (no previous row to check against)
- A host running a Ghost instance configured with a UUID that does not
  belong to it
