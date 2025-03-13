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
    And "MyNote" is in the posts
    And "MyNote2" is in the posts

  Scenario: My posts does not contain posts from followed accounts
    Given a "Create(Note)" Activity "AliceNote" by "Alice"
    And "Alice" sends "AliceNote" to the Inbox
    And "AliceNote" is in our Inbox
    When an authenticated request is made to "/.ghost/activitypub/posts"
    Then the request is accepted
    And "MyNote" is in the posts
    And "MyNote2" is in the posts
    And "AliceNote" is not in the posts

  Scenario: Profile posts includes posts we reposted
    Given a "Create(Note)" Activity "AliceNote" by "Alice"
    And "Alice" sends "AliceNote" to the Inbox
    And "AliceNote" is in our Inbox
    And we repost the object "AliceNote"
    When an authenticated request is made to "/.ghost/activitypub/posts"
    Then the request is accepted
    And "AliceNote" is in the posts
