Feature: Account API
  As an authenticated user
  I want to get account information
  So that I can view account details

  Background:
    Given an Actor "Person(Alice)"
    And we are following "Alice"
    And we are followed by "Alice"

  Scenario: Get default account
    When an authenticated "get" request is made to "/.ghost/activitypub/account/me"
    Then the request is accepted with a 200
    And the response contains "Our" account details

  Scenario: Get account by handle
    When an authenticated "get" request is made to "/.ghost/activitypub/account/@Alice@fake-external-activitypub"
    Then the request is accepted with a 200
    And the response contains "Alice" account details

  Scenario: Get non-existent account
    When an authenticated "get" request is made to "/.ghost/activitypub/account/@nonexistent@fake-external-activitypub"
    Then the request is rejected with a 500

  Scenario: Get account without authentication
    When an unauthenticated request is made to "/.ghost/activitypub/account/me"
    Then the request is rejected with a 403 
