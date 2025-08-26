# One-off Jobs

Sometimes it is necessary to run a one-off job in the production environment (GCP)

Previous examples of this:

- https://github.com/TryGhost/ActivityPub/pull/407
- https://github.com/TryGhost/ActivityPub/pull/1240

One-off jobs are normally added to the repo for a short period of time, and then 
removed when it has been confirmed that the job is no longer needed

Even though the job is one-off, it is still important to ensure that the logic
is covered by sufficient tests
