# One-off Jobs

Sometimes it is necessary to run a one-off job in the production environment (GCP)

Previous examples of this:

- [Job for migrating a key-value inbox to notifications](https://github.com/TryGhost/ActivityPub/pull/407)
- [Job for migrating Bluesky handles](https://github.com/TryGhost/ActivityPub/pull/1240)
- [Job to fix reply counts](https://github.com/TryGhost/ActivityPub/pull/1295)
- [Job to backfill ghost_uuid in sites table](https://github.com/TryGhost/ActivityPub/pull/1432)

One-off jobs are usually added to the repo for a short period of time, then
removed once confirmed that they are no longer needed

Even though the job is one-off, it is still important to ensure that the logic
is covered by sufficient tests

See the [jobs](../jobs/README.md) documentation for more details on how to 
create a new job
