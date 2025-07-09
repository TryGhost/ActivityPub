Feature: Liked Posts on Profile
  In order to see posts that I have liked
  As a user
  I want to query my liked posts

  Background:
    Given we are following "Alice"

  Scenario: Querying the liked posts
    Given a "Create(Note)" Activity "Note1" by "Alice"
    And "Alice" sends "Note1" to the Inbox
    And a "Create(Note)" Activity "Note2" by "Alice"
    And "Alice" sends "Note2" to the Inbox
    And we like the object "Note1"
    And the request is accepted
    When an authenticated request is made to "/.ghost/activitypub/v1/posts/me/liked"
    Then the request is accepted
    And "Note1" is in the liked posts
    And "Note2" is not in the liked posts

  Scenario: Liked posts are sorted by date descending
    Given a "Create(Note)" Activity "Note1" by "Alice"
    And "Alice" sends "Note1" to the Inbox
    And a "Create(Note)" Activity "Note2" by "Alice"
    And "Alice" sends "Note2" to the Inbox
    And we like the object "Note1"
    And we like the object "Note2"
    When an authenticated request is made to "/.ghost/activitypub/v1/posts/me/liked"
    Then the request is accepted
    And post "1" in the "liked posts" response is "Note2"
    And post "2" in the "liked posts" response is "Note1"

  Scenario: Liked posts are paginated
    Given a "Create(Note)" Activity "Note1" by "Alice"
    And "Alice" sends "Note1" to the Inbox
    And a "Create(Note)" Activity "Note2" by "Alice"
    And "Alice" sends "Note2" to the Inbox
    And a "Create(Note)" Activity "Note3" by "Alice"
    And "Alice" sends "Note3" to the Inbox
    And we like the object "Note1"
    And we like the object "Note2"
    And we like the object "Note3"
    When an authenticated request is made to "/.ghost/activitypub/v1/posts/me/liked?limit=2"
    Then the request is accepted
    And "Note3" is in the liked posts
    And "Note2" is in the liked posts
    And "Note1" is not in the liked posts
    And the liked posts response has a next cursor
    When an authenticated request is made to "/.ghost/activitypub/v1/posts/me/liked?limit=3"
    Then the request is accepted
    And "Note1" is in the liked posts

  Scenario: Requests with limit over 100 are rejected
    When an authenticated request is made to "/.ghost/activitypub/v1/posts/me/liked?limit=200"
    Then the request is rejected with a 400

  Scenario: Liked posts include our own posts
    Given we create a note "Note1" with the content
      """
      Hello World
      """
    And we like the object "Note1"
    When an authenticated request is made to "/.ghost/activitypub/v1/posts/me/liked"
    Then the request is accepted
    And "Note1" is in the liked posts
