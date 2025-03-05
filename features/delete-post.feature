Feature: Delete a post

  Background:
    Given an Actor "Person(Alice)"
    And we follow "Alice"
    And the request is accepted
    And a "Accept(Follow(Alice))" Activity "Accept" by "Alice"
    And "Alice" sends "Accept" to the Inbox
    And "Accept" is in our Inbox
    And a "Create(Note)" Activity "AliceNote" by "Alice"
    And "Alice" sends "AliceNote" to the Inbox
    And "AliceNote" is in our Inbox
    And we create a note "OurNote" with the content
      """
      Hello
      World
      """
    And "OurNote" is in our Outbox
    And an authenticated request is made to "/.ghost/activitypub/feed"
    And the request is accepted
    And the feed contains "OurNote"
    And the feed contains "AliceNote"

  Scenario: We can delete our post and it should remove it from the feed
    Given an authenticated "delete" request is made to "/.ghost/activitypub/post/OurNote"
    And the request is accepted with a 204
    When an authenticated request is made to "/.ghost/activitypub/feed"
    Then the request is accepted
    And the feed does not contain "OurNote"

  Scenario: Attempting to delete another user's post
    Given an authenticated "delete" request is made to "/.ghost/activitypub/post/AliceNote"
    And the request is rejected with a 403
    When an authenticated request is made to "/.ghost/activitypub/feed"
    Then the request is accepted
    And the feed contains "AliceNote"
