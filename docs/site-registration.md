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
4. Service handles `ghost_uuid` uniqueness (see below) — this can resolve
   to moving an existing site to the new host instead of creating a new one
5. Service creates new site record with the `ghost_uuid`
6. Service creates internal account for the site (unless the site already
   has one, e.g. after a move)

## Duplicate ghost_uuid Handling

The `ghost_uuid` column on `sites` has a UNIQUE constraint. When a new
host registers with a `ghost_uuid` that already belongs to an existing
site row, the service classifies the previous owner's current state by
fetching `/ghost/api/admin/site/` on the previous host:

| Previous host response                                                 | Classification | Outcome                                |
| ---------------------------------------------------------------------- | -------------- | -------------------------------------- |
| 200 with the same `site_uuid` and a matching canonical `url`           | `still-claims` | Refuse the reassignment                |
| 200 with the same `site_uuid` but a different canonical `url` (alias)  | `released`     | New site takes the UUID                |
| 200 with a different / missing `site_uuid`                             | `released`     | Move the existing site to the new host |
| 200 with non-JSON body                                                 | `released`     | Move the existing site to the new host |
| 3xx / 4xx                                                              | `released`     | Move the existing site to the new host |
| DNS NXDOMAIN (ENOTFOUND)                                               | `released`     | Move the existing site to the new host |
| Connection refused (ECONNREFUSED)                                      | `released`     | Move the existing site to the new host |
| Transient DNS failure (EAI_AGAIN)                                      | `unverifiable` | New site takes the UUID (fail-open), logged |
| 5xx / timeout / other transport error                                  | `unverifiable` | New site takes the UUID (fail-open), logged |

There are two ways a conflict can resolve in the new host's favour:

- **Move the existing site to the new host.** When the previous host no
  longer serves the install at all (DNS gone, connection refused, not a
  Ghost site anymore, or serving a different `site_uuid`), the install's
  URL has changed. The existing site row is updated to the new host,
  keeping its id, `webhook_secret`, `ghost_uuid` and — crucially — its
  account (followers, posts, keys). Actor URLs are not rewritten;
  changing the federated identity is a separate actor migration concern.
- **New site takes the UUID.** When the previous host still serves the
  install (aliased hosts, below) or the outcome is unverifiable, the new
  host registers as its own site: the previous row's `ghost_uuid` is set
  to `null` and the new row takes the UUID. The previous row's account
  data stays intact; only the UUID claim is released.

### Aliased hosts

Managed Ghost hosting providers typically give each install two valid
hostnames: a provider-controlled backend hostname (e.g.
`<pod>.provider.tld`, `<customer>.ghost.io`) and a customer's custom
domain pointed at it. Both hostnames serve the same install and return
the same `site_uuid`, so a naive "does the previous host still claim
this UUID?" check would always say yes when the customer's custom
domain registers after the backend hostname.

Ghost reports a single canonical URL in its admin settings (`site.url`).
If the previous host's response includes a `url` whose host is not the
previous host itself, that install has effectively moved its public
identity elsewhere, and we treat the previous host as having released
the UUID.

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
