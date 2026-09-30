Feature: JWKS Cache Invalidation
  ActivityPub uses identity tokens provided by Ghost to authenticate requests.
  Identity tokens are JWT signed with RS256 and verifiable by a public key.
  Ghost exposes its public keys on the JWKS endpoint at <site_url>/ghost/.well-known/jwks.json,
  and identifies the key a token was signed with using the kid in the token header.
  To avoid fetching the keys on each ActivityPub request, we cache the site's key set.

  When a site rotates its signing key, Ghost publishes the new key alongside the old one
  before it starts signing with it. If a token is signed with a key that isn't in our
  cached key set, we refetch the key set and try again.

  @jwks-cache-invalidation
  Scenario: After key rotation, the key set is refetched and requests signed by the new key are accepted
    Given the JWKS endpoint is serving the current key
    And the current key has been cached by making a successful request
    When the JWKS endpoint is updated to serve a new key alongside the current key
    And an authenticated request is made with a token signed by the new key
    Then the request is accepted with a 200

  @jwks-cache-invalidation
  Scenario: Requests signed by a key that isn't first in the key set are accepted
    Given the JWKS endpoint is serving the current key and a new key
    When an authenticated request is made with a token signed by the new key
    Then the request is accepted with a 200

  @jwks-cache-invalidation
  Scenario: Requests signed without a kid are accepted if any key in the key set verifies them
    Given the JWKS endpoint is serving the current key and a new key
    And the new key has been cached by making a successful request
    When an authenticated request is made with a token signed by the new key without a kid
    Then the request is accepted with a 200

  @jwks-cache-invalidation
  Scenario: Requests signed by a key that isn't in the key set are rejected
    Given the JWKS endpoint is serving the current key
    When an authenticated request is made with a token signed by an unknown key
    Then the request is rejected with a 403
