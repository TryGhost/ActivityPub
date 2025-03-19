Feature: My Posts on Profile
  In order to see my posts on my profile
  As a user
  I want to query my posts

  Background:
    Given we create a note "MyNote" with the content
      """
      Hello World 1
      """
    And we are following "Alice"
    And we are following "Bob"
    And fake timer advances time by 1000 milliseconds
    And a "Create(Note)" Activity "AliceNote" by "Alice"
    And "Alice" sends "AliceNote" to the Inbox
    And "AliceNote" is in our Inbox
    And we repost the object "AliceNote"

  Scenario: Querying profile posts
    Given we create a note "MyNote2" with the content
      """
      Hello World 2
      """
    When an authenticated request is made to "/.ghost/activitypub/posts"
    Then the request is accepted
    And "MyNote" is in the posts
    And "MyNote2" is in the posts

  Scenario: My posts does not contain posts from followed accounts
    And a "Create(Note)" Activity "BobNote" by "Bob"
    And "Bob" sends "BobNote" to the Inbox
    And "BobNote" is in our Inbox
    When an authenticated request is made to "/.ghost/activitypub/posts"
    Then the request is accepted
    And "MyNote" is in the posts
    And "BobNote" is not in the posts

  Scenario: Profile posts includes posts we reposted
    When an authenticated request is made to "/.ghost/activitypub/posts"
    Then the request is accepted
    And "AliceNote" is in the posts

  Scenario: Profile posts are sorted by date descending
    When an authenticated request is made to "/.ghost/activitypub/posts"
    Then the request is accepted
    And post "1" in the "posts" response is "AliceNote"
    And post "2" in the "posts" response is "MyNote"

  Scenario: Profile posts are paginated
    Given fake timer advances time by 1000 milliseconds
    And a "Create(Note)" Activity "BobNote" by "Bob"
    And "Bob" sends "BobNote" to the Inbox
    And "BobNote" is in our Inbox
    And we repost the object "BobNote"
    When an authenticated request is made to "/.ghost/activitypub/posts?limit=2"
    Then the request is accepted
    And "BobNote" is in the posts
    And "AliceNote" is in the posts
    And "MyNote" is not in the posts
    And the posts response has a next cursor
    When an authenticated request is made to "/.ghost/activitypub/posts?limit=3"
    Then the request is accepted
    And "MyNote" is in the posts
    And "BobNote" is in the posts
    And "AliceNote" is in the posts
