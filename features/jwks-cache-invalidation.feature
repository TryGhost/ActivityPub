Feature: JWKS Cache Invalidation
  As a system administrator
  When the JWKS key becomes outdated (e.g., after site migration)
  The system should automatically invalidate the cache and refetch

  @jwks-cache-invalidation
  Scenario: Cached JWKS key becomes outdated and is automatically refreshed
    Given the JWKS endpoint is serving an old key
    And the old key has been cached by making a successful request
    When the JWKS endpoint is updated to serve a new key
    And an authenticated request is made with a token signed by the new key
    Then the request is accepted with a 200
    And the response contains "Our" account details
