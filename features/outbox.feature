Feature: Outbox
  In order to view the activities performed by an actor
  As a fediverse server
  I want be able to retrieve an actor's activities from their outbox

  Scenario: outbox contains relevant activities
    Given an Actor "Alice"
    And a "Create(Article)" Activity "C" by "Alice"
    And a "Announce(C)" Activity "An" by "Alice"
    And a "Follow(Us)" Activity "F" by "Alice"
    And a "Accept(F)" Activity "A" by "Alice"
    And "Alice" adds "C" to the Outbox
    And "Alice" adds "An" to the Outbox
    And "Alice" adds "F" to the Outbox
    And "Alice" adds "A" to the Outbox
    When the contents of the outbox is requested
    Then the outbox contains 2 activities

  Scenario: outbox contains is ordered reverse chronologically
    Given an Actor "Alice"
    And a "Create(Article)" Activity "A1" by "Alice"
    And a "Create(Article)" Activity "A2" by "Alice"
    And "Alice" adds "A1" to the Outbox
    And "Alice" adds "A2" to the Outbox
    When the contents of the outbox is requested
    Then the outbox contains 2 activities
    And the items in the outbox are in the order: "A2, A1"
