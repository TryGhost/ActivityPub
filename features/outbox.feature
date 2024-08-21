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
    When the contents of the outbox is requested
    Then the outbox contains 1 activity
    And a "Create(Article)" activity is in the Outbox
