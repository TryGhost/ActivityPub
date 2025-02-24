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

  Scenario: Querying the feed
    Given a "Create(Note)" Activity "Note1" by "Alice"
    And "Alice" sends "Note1" to the Inbox
    And "Note1" is in our Inbox
    And a "Create(Article)" Activity "Article1" by "Alice"
    And "Alice" sends "Article1" to the Inbox
    And "Article1" is in our Inbox
    When an authenticated request is made to "/.ghost/activitypub/feed"
    Then the request is accepted
    And the feed contains "Note1"
    And the feed does not contain "Article1"

  Scenario: Feed is sorted by date descending
    Given a "Create(Note)" Activity "Note1" by "Alice"
    And "Alice" sends "Note1" to the Inbox
    And "Note1" is in our Inbox
    And a "Create(Note)" Activity "Note2" by "Alice"
    And "Alice" sends "Note2" to the Inbox
    And "Note2" is in our Inbox
    When an authenticated request is made to "/.ghost/activitypub/feed"
    Then the request is accepted
    And post "1" in the feed is "Note2"
    And post "2" in the feed is "Note1"

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
    When an authenticated request is made to "/.ghost/activitypub/feed?limit=2"
    Then the request is accepted
    And the feed contains "Note3"
    And the feed contains "Note2"
    And the feed does not contain "Note1"
    And the feed has a next cursor
    When an authenticated request is made to "/.ghost/activitypub/feed?limit=3"
    Then the request is accepted
    And the feed contains "Note1"

  Scenario: Requests with limit over 100 are rejected
    When an authenticated request is made to "/.ghost/activitypub/feed?limit=200"
    Then the request is rejected with a 400

  Scenario: Feed includes our own posts
    When we create a note "Note1" with the content
      """
      Hello World
      """
    When an authenticated request is made to "/.ghost/activitypub/feed"
    Then the request is accepted
    And the feed contains "Note1"

  Scenario: Feed includes posts we reposted
    Given a "Create(Note)" Activity "Note1" by "Alice"
    And "Alice" sends "Note1" to the Inbox
    And "Note1" is in our Inbox
    And we repost the object "Note1"
    And the request is accepted
    When an authenticated request is made to "/.ghost/activitypub/feed"
    Then the request is accepted
    And the feed contains "Note1"

  Scenario: Feed includes posts from followed accounts
    Given a "Create(Note)" Activity "Note1" by "Alice"
    And "Alice" sends "Note1" to the Inbox
    And "Note1" is in our Inbox
    When an authenticated request is made to "/.ghost/activitypub/feed"
    Then the request is accepted
    And the feed contains "Note1"

  Scenario: Feed includes reposts from followed accounts
    Given an Actor "Person(Bob)"
    And a "Note" Object "Note1" by "Bob"
    And a "Announce(Note1)" Activity "Repost1" by "Alice"
    And "Alice" sends "Repost1" to the Inbox
    And "Repost1" is in our Inbox
    When an authenticated request is made to "/.ghost/activitypub/feed"
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
    When an authenticated request is made to "/.ghost/activitypub/feed"
    Then the request is accepted
    And the feed contains "Note1"
    And the feed does not contain "ReplyCreate"

  Scenario: Querying the inbox (feed filtered to only return articles)
    Given a "Create(Article)" Activity "Article1" by "Alice"
    And "Alice" sends "Article1" to the Inbox
    And "Article1" is in our Inbox
    And a "Create(Article)" Activity "Article2" by "Alice"
    And "Alice" sends "Article2" to the Inbox
    And "Article2" is in our Inbox
    And a "Create(Note)" Activity "Note1" by "Alice"
    And "Alice" sends "Note1" to the Inbox
    And "Note1" is in our Inbox
    When an authenticated request is made to "/.ghost/activitypub/inbox"
    Then the request is accepted
    And post "1" in the feed is "Article2"
    And post "2" in the feed is "Article1"
    And the feed does not contain "Note1"
