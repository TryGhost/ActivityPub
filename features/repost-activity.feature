Feature: Reposting a post
  In order to share content with my followers
  As a user
  I want to be able to repost a post in my feed

  Scenario: Reposting a post that has not been reposted before
    Given an Actor "Person(Alice)"
    And we follow "Alice"
    And the request is accepted
    And a "Accept(Follow(Alice))" Activity "Accept" by "Alice"
    And "Alice" sends "Accept" to the Inbox
    And "Accept" is in our Inbox
    And a "Create(Note)" Activity "Note" by "Alice"
    And "Alice" sends "Note" to the Inbox
    And "Note" is in our Inbox
    When we repost the object "Note"
    Then the request is accepted
    And the object "Note" should be reposted
    And the object "Note" should have a repost count greater than 0
    And a "Announce(Note)" activity is sent to "Alice"

  Scenario: Reposting an post that has been reposted before
    Given an Actor "Person(Alice)"
    And we follow "Alice"
    And the request is accepted
    And a "Accept(Follow(Alice))" Activity "Accept" by "Alice"
    And "Alice" sends "Accept" to the Inbox
    And "Accept" is in our Inbox
    And a "Create(Note)" Activity "Note" by "Alice"
    And "Alice" sends "Note" to the Inbox
    And "Note" is in our Inbox
    And we repost the object "Note"
    Then the request is accepted
    Then we repost the object "Note"
    Then the request is rejected with a 409
