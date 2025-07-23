Feature: Reposting a post/note
  In order to share content with my followers
  As a user
  I want to be able to repost a post in my feed

  Scenario: Reposting a post/note
    Given we are following "Alice"
    And a "Create(Note)" Activity "Note" by "Alice"
    And "Alice" sends "Note" to the Inbox
    When we repost the object "Note"
    Then the request is accepted
    And the object "Note" should be reposted
    And the object "Note" should have a repost count of 1
    And a "Announce(Note)" activity is sent to "Alice"

  Scenario: Trying to repost a post/note that has already been reposted
    Given we are following "Alice"
    And a "Create(Note)" Activity "Note" by "Alice"
    And "Alice" sends "Note" to the Inbox
    And we repost the object "Note"
    And the request is accepted
    When we repost the object "Note"
    Then the request is rejected with a 409

  Scenario: Undoing a repost
    Given we are following "Alice"
    And a "Create(Note)" Activity "Note" by "Alice"
    And "Alice" sends "Note" to the Inbox
    And we repost the object "Note"
    And the request is accepted
    When we undo the repost of the object "Note"
    Then the request is accepted
    And the object "Note" should not be reposted
    And a "Undo(Announce)" activity is sent to "Alice"

  Scenario: Trying to undo a repost on a post/note that has not been reposted
    Given we are following "Alice"
    And a "Create(Note)" Activity "Note" by "Alice"
    And "Alice" sends "Note" to the Inbox
    When we undo the repost of the object "Note"
    Then the request is rejected with a 409

  @only
  Scenario: Delivering reposts to internal accounts
    Given I have internal account followers
    When I repost alices note
    Then the note is in my followers feeds
    And alice recieves a repost notification
