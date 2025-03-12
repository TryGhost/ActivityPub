Feature: My Posts on Profile
  In order to see my posts on my profile
  As a user
  I want to query my posts

  Background:
    Given we create a note "Note1" with the content
      """
      Hello World
      """
    And we create a note "Note2" with the content
      """
      Hello World 2
      """
    And we are following "Alice"

  Scenario: Querying profile posts
    When an authenticated request is made to "/.ghost/activitypub/posts"
    Then the request is accepted
    And the "posts" response contains "Note1"
    And the "posts" response contains "Note2"

  Scenario: My posts does not contain posts from followed accounts
    Given a "Create(Note)" Activity "Note3" by "Alice"
    And "Alice" sends "Note3" to the Inbox
    And "Note3" is in our Inbox
    When an authenticated request is made to "/.ghost/activitypub/posts"
    Then the request is accepted
    And the "posts" response contains "Note1"
    And the "posts" response contains "Note2"
    And the "posts" response does not contain "Note3"

  Scenario: Requests with limit over 100 are rejected
    When an authenticated request is made to "/.ghost/activitypub/posts?limit=200"
    Then the request is rejected with a 400

  Scenario: Profile posts includes posts we reposted
    Given a "Create(Note)" Activity "Note3" by "Alice"
    And "Alice" sends "Note3" to the Inbox
    And "Note3" is in our Inbox
    And we repost the object "Note3"
    When an authenticated request is made to "/.ghost/activitypub/posts"
    Then the request is accepted
    And the "posts" response contains "Note3"
