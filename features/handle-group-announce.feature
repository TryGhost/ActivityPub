Feature: Handling activities announced by a Group
  Background:
    Given an Actor "Person(Alice)"
    And we are following "Group(Wonderland)"

  Scenario: We receive a Announce(Note) activity from a Group
    Given we publish a note
    When "Wonderland" reposts our note
    Then the repost is in our notifications
