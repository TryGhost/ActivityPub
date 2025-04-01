Feature: Account API
  As an authenticated user
  I want to get account information
  So that I can view account details

  Background:
    Given we are following "Alice"
    And we are following "Bob"
    And we are followed by "Alice"
    And we are followed by "Bob"

  Scenario: Get default account
    When an authenticated "get" request is made to "/.ghost/activitypub/account"
    Then the request is accepted with a 200
    And the response contains our account details

  Scenario: Get account by handle
    When an authenticated "get" request is made to "/.ghost/activitypub/account?handle=@johnonolan@mastodon.xyz"
    Then the request is accepted with a 200
    And the response contains John's account details

  Scenario: Get non-existent account
    When an authenticated "get" request is made to "/.ghost/activitypub/account?handle=@nonexistent@fake-external-activitypub"
    Then the request is rejected with a 404

  Scenario: Get account with invalid handle
    When an authenticated "get" request is made to "/.ghost/activitypub/account?handle=invalid-handle"
    Then the request is rejected with a 404

  Scenario: Get account without authentication
    When an unauthenticated request is made to "/.ghost/activitypub/account"
    Then the request is rejected with a 403 