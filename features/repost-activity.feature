Feature: Reposting an object
  As a user
  I want to repost an object in my feed
  So that I can share the content with my followers

  Scenario: Reposting an object that has not been reposted before
    Given an Actor "Person(Alice)"
    Given we follow "Alice"
    Then the request is accepted
    Given a "Accept(Follow(Alice))" Activity "Accept" by "Alice"
    And "Alice" sends "Accept" to the Inbox
    And "Accept" is in our Inbox
    Given a "Create(Note)" Activity "Note" by "Alice"
    When "Alice" sends "Note" to the Inbox
    And "Note" is in our Inbox
    And we repost the object "Note"
    Then a "Announce(Note)" activity is sent to "Alice"

  Scenario: Reposting an object that has been reposted before
    Given an Actor "Person(Alice)"
    Given we follow "Alice"
    Then the request is accepted
    Given a "Accept(Follow(Alice))" Activity "Accept" by "Alice"
    And "Alice" sends "Accept" to the Inbox
    And "Accept" is in our Inbox
    Given a "Create(Note)" Activity "Note" by "Alice"
    When "Alice" sends "Note" to the Inbox
    And "Note" is in our Inbox
    And we repost the object "Note"
    Then the request is accepted
    Then we repost the object "Note"
    Then the request is rejected with a 409
