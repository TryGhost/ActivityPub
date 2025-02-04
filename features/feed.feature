Feature: Feed
  In order to see posts from accounts I follow
  As a user
  I want to query my feed

  Background:
    Given an Actor "Person(Alice)"
    And we follow "Alice"
    And the request is accepted
    And a "Accept(Follow(Alice))" Activity "Accept" by "Alice"
    And "Alice" sends "Accept" to the Inbox
    And "Accept" is in our Inbox

  Scenario: Querying the feed with no filters
    Given a "Create(Note)" Activity "Note1" by "Alice"
    And "Alice" sends "Note1" to the Inbox
    And "Note1" is in our Inbox
    And a "Create(Article)" Activity "Article1" by "Alice"
    And "Alice" sends "Article1" to the Inbox
    And "Article1" is in our Inbox
    When we request the feed
    Then the request is accepted
    And the feed contains "Note1"
    And the feed contains "Article1"

  Scenario: Querying the feed filtered by type: Article
    Given a "Create(Article)" Activity "Article1" by "Alice"
    And "Alice" sends "Article1" to the Inbox
    And "Article1" is in our Inbox
    And a "Create(Note)" Activity "Note1" by "Alice"
    And "Alice" sends "Note1" to the Inbox
    And "Note1" is in our Inbox
    When we request the feed filtered by type "Article"
    Then the request is accepted
    And the feed contains "Article1"
    And the feed does not contain "Note1"

  Scenario: Querying the feed filtered by type: Note
    Given a "Create(Note)" Activity "Note1" by "Alice"
    And "Alice" sends "Note1" to the Inbox
    And "Note1" is in our Inbox
    And a "Create(Article)" Activity "Article1" by "Alice"
    And "Alice" sends "Article1" to the Inbox
    And "Article1" is in our Inbox
    When we request the feed filtered by type "Note"
    Then the request is accepted
    And the feed contains "Note1"
    And the feed does not contain "Article1"

  Scenario: Feed only includes posts
    Given a "Create(Note)" Activity "Note1" by "Alice"
    And "Alice" sends "Note1" to the Inbox
    And "Note1" is in our Inbox
    And a "Create(Article)" Activity "Article1" by "Alice"
    And "Alice" sends "Article1" to the Inbox
    And "Article1" is in our Inbox
    And a "Like(Note1)" Activity "Like1" by "Alice"
    And "Alice" sends "Like1" to the Inbox
    And "Like1" is in our Inbox
    When we request the feed
    Then the request is accepted
    And the feed contains "Note1"
    And the feed contains "Article1"
    And the feed does not contain "Like1"

  Scenario: Feed is paginated
    Given a "Create(Note)" Activity "Note1" by "Alice"
    And "Alice" sends "Note1" to the Inbox
    And "Note1" is in our Inbox
    And a "Create(Note)" Activity "Note2" by "Alice"
    And "Alice" sends "Note2" to the Inbox
    And "Note2" is in our Inbox
    And a "Create(Note)" Activity "Note3" by "Alice"
    And "Alice" sends "Note3" to the Inbox
    And "Note3" is in our Inbox
    When we request the feed with a limit of 2
    Then the request is accepted
    And the feed contains "Note3"
    And the feed contains "Note2"
    And the feed does not contain "Note1"
    And the feed has a next cursor
    When we request the feed with the next cursor
    Then the request is accepted
    And the feed contains "Note1"

  Scenario: Requests with limit over 100 are rejected
    When we request the feed with a limit of 200
    Then the request is rejected with a 400

  Scenario: Feed includes our own posts
    When we create a note "Note1" with the content
      """
      Hello World
      """
    And we request the feed
    Then the request is accepted
    And the feed contains "Note1"

  Scenario: Feed includes posts we reposted
    Given a "Create(Note)" Activity "Note1" by "Alice"
    And "Alice" sends "Note1" to the Inbox
    And "Note1" is in our Inbox
    And we repost the object "Note1"
    And the request is accepted
    When we request the feed
    Then the request is accepted
    And the feed contains "Note1"

  Scenario: Feed includes posts from followed accounts
    Given a "Create(Note)" Activity "Note1" by "Alice"
    And "Alice" sends "Note1" to the Inbox
    And "Note1" is in our Inbox
    When we request the feed
    Then the request is accepted
    And the feed contains "Note1"

  Scenario: Feed includes reposts from followed accounts
    Given an Actor "Person(Bob)"
    And a "Note" Object "Note1" by "Bob"
    And a "Announce(Note1)" Activity "Repost1" by "Alice"
    And "Alice" sends "Repost1" to the Inbox
    And "Repost1" is in our Inbox
    When we request the feed
    Then the request is accepted
    And the feed contains "Note1"

  Scenario: Feed excludes replies
    Given a "Create(Note)" Activity "Note1" by "Alice"
    And "Alice" sends "Note1" to the Inbox
    And "Note1" is in our Inbox
    And a "Note" Object "Reply1" by "Alice"
    And "Reply1" is a reply to "Note1"
    And a "Create(Reply1)" Activity "ReplyCreate" by "Alice"
    And "Alice" sends "ReplyCreate" to the Inbox
    And "ReplyCreate" is in our Inbox
    When we request the feed
    Then the request is accepted
    And the feed contains "Note1"
    And the feed does not contain "ReplyCreate"
