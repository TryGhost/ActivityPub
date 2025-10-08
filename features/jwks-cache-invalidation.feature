Feature: JWKS Cache Invalidation
  ActivityPub requests are authenticated with identity tokens issued by Ghost.
  These tokens are JWTs signed with RS256 and can be verified using Ghost's JWKS endpoint exposed at <site_url>/ghost/.well-known/jwks.json.
  To avoid fetching JWKS on every verification, we cache them in Redis.
  If the JWKS are rotated (e.g., after site migration), we want to automatically invalidate the Redis cache and refetch the new JWKS.

  @jwks-cache-invalidation
  Scenario: Stale JWKS keys are evicted and replaced with fresh ones on read
    Given the JWKS endpoint is serving an old key
    And the old key has been cached by making a successful request
    When the JWKS endpoint is updated to serve a new key
    And an authenticated request is made with a token signed by the new key
    Then the request is accepted with a 200
