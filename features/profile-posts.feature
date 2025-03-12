Feature: My Posts on Profile
  In order to see my posts on my profile
  As a user
  I want to query my posts

  Background:
    Given we create a note "MyNote" with the content
      """
      Hello World 1
      """
    And we create a note "MyNote2" with the content
      """
      Hello World 2
      """
    And we are following "Alice"

  Scenario: Querying profile posts
    When an authenticated request is made to "/.ghost/activitypub/posts"
    Then the request is accepted
    And the "posts" response contains "MyNote"
    And the "posts" response contains "MyNote2"

  Scenario: My posts does not contain posts from followed accounts
    Given a "Create(Note)" Activity "AliceNote" by "Alice"
    And "Alice" sends "AliceNote" to the Inbox
    And "AliceNote" is in our Inbox
    When an authenticated request is made to "/.ghost/activitypub/posts"
    Then the request is accepted
    And the "posts" response contains "MyNote"
    And the "posts" response contains "MyNote2"
    And the "posts" response does not contain "AliceNote"

  Scenario: Profile posts are sorted by date descending
    When an authenticated request is made to "/.ghost/activitypub/posts"
    Then the request is accepted
    And post "1" in the "posts" response is "MyNote2"
    And post "2" in the "posts" response is "MyNote"

  Scenario: Requests with limit over 100 are rejected
    When an authenticated request is made to "/.ghost/activitypub/posts?limit=200"
    Then the request is rejected with a 400

  Scenario: Profile posts includes posts we reposted
    Given a "Create(Note)" Activity "AliceNote" by "Alice"
    And "Alice" sends "AliceNote" to the Inbox
    And "AliceNote" is in our Inbox
    And we repost the object "AliceNote"
    When an authenticated request is made to "/.ghost/activitypub/posts"
    Then the request is accepted
    And the "posts" response contains "AliceNote"
