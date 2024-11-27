Feature: Follow accounts from their handle

  Scenario: We can follow an account only once
    Given an Actor "Person(Alice)"
    Given we follow "Alice"
    Then the request is accepted
    Given a "Accept(Follow(Alice))" Activity "A" by "Alice"
    And "Alice" sends "A" to the Inbox
    And "A" is in our Inbox
    Given we follow "Alice"
    Then the request is rejected with a 409

  Scenario: We cannot follow ourselves
    Given we follow "Us"
    Then the request is rejected with a 400
