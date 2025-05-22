Feature: Announce(Note)
  We want to handle Announce(Note) activities in the Inbox

  Scenario: We receive a Announce(Note) activity from someone we follow
    Given we are following "Alice"
    And we publish a note
    When "Alice" reposts our note
    Then the repost is in our notifications

  Scenario: We receive a Announce(Note) activity from someone we don't follow
    Given we are not following "Alice"
    And we publish a note
    When "Alice" reposts our note
    Then the repost is in our notifications
