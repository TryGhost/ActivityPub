Feature: Liking an object
  As a user
  I want to like an object in my feed
  So that I can express my approval of the content

  Scenario: Liking an object that has not been liked before
    Given we are following "Alice"
    Given a "Create(Note)" Activity "Note" by "Alice"
    When "Alice" sends "Note" to the Inbox
    And "Note" is in our Inbox
    And we like the object "Note"
    Then the request is accepted
    And the object "Note" should be liked
    And a "Like(Note)" activity is sent to "Alice"

  Scenario: Liking an object that has been liked before
    Given we are following "Alice"
    Given a "Create(Note)" Activity "Note" by "Alice"
    When "Alice" sends "Note" to the Inbox
    And "Note" is in our Inbox
    And we like the object "Note"
    Then the request is accepted
    Then we like the object "Note"
    Then the request is rejected with a 409

  Scenario: Unliking an object that has not been liked before
    Given we are following "Alice"
    Given a "Create(Note)" Activity "Note" by "Alice"
    When "Alice" sends "Note" to the Inbox
    And "Note" is in our Inbox
    Then we unlike the object "Note"
    Then the request is rejected with a 409

  Scenario: Unliking an object that has been liked before
    Given we are following "Alice"
    Given a "Create(Note)" Activity "Note" by "Alice"
    When "Alice" sends "Note" to the Inbox
    And "Note" is in our Inbox
    And we like the object "Note"
    Then the request is accepted
    Then we unlike the object "Note"
    Then the request is accepted
    And the object "Note" should not be liked
    And the object "Note" should not be in the "liked" collection
    And a "Undo(Like)" activity is sent to "Alice"
