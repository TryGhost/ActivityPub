Feature: JWKS Cache Invalidation
  ActivityPub uses identity tokens provided by Ghost to authenticate requests.
  Identity tokens are JWT signed with RS256 and verifiable by a public key.
  Ghost exposes the public key on the JWKS endpoint at <site_url>/ghost/.well-known/jwks.json.
  To avoid fetching the key on each ActivityPub request, we cache it in Redis.

  The public key might change after e.g. a site migration. In this case, we want to invalidate the cached key and fetch a new, valid one.

  @jwks-cache-invalidation
  Scenario: After public key rotation, the cache is refreshed and requests signed by the new key are accepted
    Given the JWKS endpoint is serving an old key
    And the old key has been cached by making a successful request
    When the JWKS endpoint is updated to serve a new key
    And an authenticated request is made with a token signed by the new key
    Then the request is accepted with a 200
