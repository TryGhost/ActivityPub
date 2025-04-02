Feature: Account API
  As an authenticated user
  I want to get account information
  So that I can view account details

  Background:
    Given an Actor "Person(Alice)"
    And we are following "Alice"
    And we are followed by "Alice"
    

  @only
  Scenario: Get default account
    When an authenticated "get" request is made to "/.ghost/activitypub/account/index"
    Then the request is accepted with a 200
    And the response contains our account details

  @only
  Scenario: Get account by handle
    When an authenticated "get" request is made to "/.ghost/activitypub/account/@Alice@fake-external-activitypub"
    Then the request is accepted with a 200
    And the response contains "Alice"'s account details

  @only
  Scenario: Get non-existent account
    When an authenticated "get" request is made to "/.ghost/activitypub/account/@nonexistent@fake-external-activitypub"
    Then the request is rejected with a 500

  @only
  Scenario: Get account without authentication
    When an unauthenticated request is made to "/.ghost/activitypub/account/index"
    Then the request is rejected with a 403 
