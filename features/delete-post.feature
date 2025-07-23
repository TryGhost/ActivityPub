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
    And the note "OurNote" is in our feed
    And the note "AliceNote" is in our feed

  Scenario: We can delete our post and it should remove it from the feed
    Given an authenticated "delete" request is made to "/.ghost/activitypub/v1/post/OurNote"
    And the request is accepted with a 204
    And the note "OurNote" is not in our feed
    And a "Delete(OurNote)" activity is sent to "Alice"

  Scenario: Attempting to delete another user's post
    Given an authenticated "delete" request is made to "/.ghost/activitypub/v1/post/AliceNote"
    And the request is rejected with a 403
    And the note "AliceNote" is in our feed

  Scenario: Delivering deletes to internal accounts
    Given I have internal account followers
    When I delete a note
    Then the note is not in my followers feeds
