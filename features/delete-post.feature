Feature: Delete a post

  Background:
    Given we are following "Alice"
    And we are followed by "Alice"
    And a "Create(Note)" Activity "AliceNote" by "Alice"
    And "Alice" sends "AliceNote" to the Inbox
    And we create a note "OurNote" with the content
      """
      Hello
      World
      """
    And an authenticated request is made to "/.ghost/activitypub/feed"
    And the request is accepted
    And "OurNote" is in the feed
    And "AliceNote" is in the feed

  Scenario: We can delete our post and it should remove it from the feed
    Given an authenticated "delete" request is made to "/.ghost/activitypub/post/OurNote"
    And the request is accepted with a 204
    When an authenticated request is made to "/.ghost/activitypub/feed"
    Then the request is accepted
    And "OurNote" is not in the feed
    And a "Delete(OurNote)" activity is sent to "Alice"

  Scenario: Attempting to delete another user's post
    Given an authenticated "delete" request is made to "/.ghost/activitypub/post/AliceNote"
    And the request is rejected with a 403
    When an authenticated request is made to "/.ghost/activitypub/feed"
    Then the request is accepted
    And "AliceNote" is in the feed
