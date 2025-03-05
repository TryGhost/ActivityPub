Feature: Delete a post

  Background:
    Given an Actor "Person(Alice)"
    And we follow "Alice"
    And the request is accepted
    And a "Accept(Follow(Alice))" Activity "Accept" by "Alice"
    And "Alice" sends "Accept" to the Inbox
    And "Accept" is in our Inbox
    Given a "Create(Note)" Activity "AliceNote" by "Alice"
    And "Alice" sends "AliceNote" to the Inbox
    And "AliceNote" is in our Inbox
    Given we create a note "OurNote" with the content
      """
      Hello
      World
      """
    Then "OurNote" is in our Outbox
    When an authenticated request is made to "/.ghost/activitypub/feed"
    Then the request is accepted
    And the feed contains "OurNote"
    And the feed contains "AliceNote"

  Scenario: We can delete our post and it should remove it from the feed
    When an authenticated "delete" request is made to "/.ghost/activitypub/post/OurNote"
    Then the request is accepted with a 204
    When an authenticated request is made to "/.ghost/activitypub/feed"
    Then the request is accepted
    And the feed does not contain "OurNote"
 
  Scenario: Attempting to delete another user's post
    When an authenticated "delete" request is made to "/.ghost/activitypub/post/AliceNote"
    Then the request is rejected with a 403
    When an authenticated request is made to "/.ghost/activitypub/feed"
    Then the request is accepted
    And the feed contains "AliceNote"


