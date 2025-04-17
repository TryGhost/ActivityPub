Feature: Announce(Note)
  We want to handle Announce(Note) activities in the Inbox

  Scenario: We recieve a Announce(Note) activity from someone we follow
    Given we are following "Alice"
    Given a "Announce(Note)" Activity "A" by "Alice"
    When "Alice" sends "A" to the Inbox

  Scenario: We recieve a Announce(Note) activity from someone we don't follow
    Given an Actor "Person(Alice)"
    Given a "Announce(Note)" Activity "A" by "Alice"
    When "Alice" sends "A" to the Inbox
