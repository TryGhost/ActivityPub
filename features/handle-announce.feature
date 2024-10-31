Feature: Announce(Note)
  We want to handle Announce(Note) activities in the Inbox

  Scenario: We recieve a Announce(Note) activity from someone we follow
    Given an Actor "Alice"
    Given we follow "Alice"
    Then the request is accepted
    Given a "Accept(Follow(Alice))" Activity "Accept" by "Alice"
    And "Alice" sends "Accept" to the Inbox
    Given a "Announce(Note)" Activity "A" by "Alice"
    When "Alice" sends "A" to the Inbox
    Then the request is accepted
    Then "A" is in our Inbox

  Scenario: We recieve a Announce(Note) activity from someone we don't follow
    Given an Actor "Alice"
    Given a "Announce(Note)" Activity "A" by "Alice"
    When "Alice" sends "A" to the Inbox
    Then the request is accepted
    Then "A" is not in our Inbox
