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
4. Service handles `ghost_uuid` uniqueness:
   - Checks if another site already has this `ghost_uuid`
   - If found, nullifies the `ghost_uuid` on the old site
   - This handles domain changes where the same Ghost instance registers with a new domain
5. Service creates new site record with the `ghost_uuid`
6. Service creates internal account for the site

## Duplicate ghost_uuid Handling

The `ghost_uuid` uniquely identifies a Ghost site. When a Ghost site changes domains and re-registers:

- **Old site** (`old-domain.com`): `ghost_uuid` is set to `null`, site remains active with all data intact
- **New site** (`new-domain.com`): Gets the `ghost_uuid`, becomes the active registration for that Ghost instance
