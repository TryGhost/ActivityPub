Feature: Feed

  Background:
    Given we are following "Alice"

  Scenario: Feed includes notes
    Given a "Create(Note)" Activity "Note1" by "Alice"
    When "Alice" sends "Note1" to the Inbox
    Then the note "Note1" is in our feed

  Scenario: Feed does not include articles
    Given a "Create(Article)" Activity "Article1" by "Alice"
    When "Alice" sends "Article1" to the Inbox
    Then the article "Article1" is not in our feed

  Scenario: Feed is sorted by date descending
    Given a "Create(Note)" Activity "Note1" by "Alice"
    And "Alice" sends "Note1" to the Inbox
    And the note "Note1" is in our feed
    And a "Create(Note)" Activity "Note2" by "Alice"
    And "Alice" sends "Note2" to the Inbox
    And the note "Note2" is in our feed
    When an authenticated request is made to "/.ghost/activitypub/v1/feed/notes"
    Then the request is accepted
    And post "1" in the "feed" response is "Note2"
    And post "2" in the "feed" response is "Note1"

  Scenario: Feed is paginated
    Given a "Create(Note)" Activity "Note1" by "Alice"
    And "Alice" sends "Note1" to the Inbox
    And the note "Note1" is in our feed
    And a "Create(Note)" Activity "Note2" by "Alice"
    And "Alice" sends "Note2" to the Inbox
    And the note "Note2" is in our feed
    And a "Create(Note)" Activity "Note3" by "Alice"
    And "Alice" sends "Note3" to the Inbox
    And the note "Note3" is in our feed
    When an authenticated request is made to "/.ghost/activitypub/v1/feed/notes?limit=2"
    Then the request is accepted
    And "Note3" is in the feed
    And "Note2" is in the feed
    And "Note1" is not in the feed
    And the feed response has a next cursor
    When an authenticated request is made to "/.ghost/activitypub/v1/feed/notes?limit=3"
    Then the request is accepted
    And "Note1" is in the feed

  Scenario: Requests with limit over 100 are rejected
    When an authenticated request is made to "/.ghost/activitypub/v1/feed/notes?limit=200"
    Then the request is rejected with a 400

  Scenario: Feed includes our own posts
    When we create a note "Note1" with the content
      """
      Hello World
      """
    Then the note "Note1" is in our feed

  Scenario: Feed includes posts we reposted
    Given a "Create(Note)" Activity "Note1" by "Alice"
    And "Alice" sends "Note1" to the Inbox
    When we repost the object "Note1"
    Then the request is accepted
    And the note "Note1" is in our feed

  Scenario: Feed includes posts from followed accounts
    Given a "Create(Note)" Activity "Note1" by "Alice"
    When "Alice" sends "Note1" to the Inbox
    Then the note "Note1" is in our feed

  Scenario: Feed includes reposts from followed accounts
    Given an Actor "Person(Bob)"
    And a "Note" Object "Note1" by "Bob"
    And a "Announce(Note1)" Activity "Repost1" by "Alice"
    When "Alice" sends "Repost1" to the Inbox
    Then the note "Note1" is in our feed

  Scenario: Feed excludes replies
    Given we publish a note
    When "Alice" sends us a reply to our note
    Then the reply is not in our feed

  Scenario: Feed is sanitised
    Given a "Create(Note)" Activity "Note" by "Alice" with content "Hello, world!<script>alert('boo')</script>"
    When "Alice" sends "Note" to the Inbox
    Then the note "Note" is in our feed and has content "Hello, world!<script></script>"
