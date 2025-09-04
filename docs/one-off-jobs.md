# One-off Jobs

Sometimes it is necessary to run a one-off job in the production environment (GCP)

Previous examples of this:

- [PR #407](https://github.com/TryGhost/ActivityPub/pull/407)
- [PR #1240](https://github.com/TryGhost/ActivityPub/pull/1240)

One-off jobs are usually added to the repo for a short period, then
removed once confirmed no longer needed.

Even though the job is one-off, it is still important to ensure that the logic
is covered by sufficient tests
