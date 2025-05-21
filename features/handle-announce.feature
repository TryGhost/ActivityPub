Feature: Announce(Note)
  We want to handle Announce(Note) activities in the Inbox

  Scenario: We receive a Announce(Note) activity from someone we follow
    Given we are following "Alice"
    Given a "Announce(Note)" Activity "A" by "Alice"
    When "Alice" sends "A" to the Inbox
    Then the request is accepted
    Then "A" is in our Inbox

  Scenario: We receive a Announce(Note) activity from someone we don't follow
    Given an Actor "Person(Alice)"
    Given a "Announce(Note)" Activity "A" by "Alice"
    When "Alice" sends "A" to the Inbox
    Then the request is accepted
    Then "A" is not in our Inbox
