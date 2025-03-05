Feature: Delete a post

  Background:
    Given an Actor "Person(Alice)"
    And we follow "Alice"
    And the request is accepted
    And a "Accept(Follow(Alice))" Activity "Accept" by "Alice"
    And "Alice" sends "Accept" to the Inbox
    And "Accept" is in our Inbox
    Given a "Create(Note)" Activity "Note" by "Alice"
    And "Alice" sends "Note" to the Inbox
    And "Note" is in our Inbox
    When an authenticated request is made to "/.ghost/activitypub/feed"
    Then the request is accepted
    And the feed contains "Note"
    Given we create a note "Note1" with the content
      """
      Hello
      World
      """
    Then "Note1" is in our Outbox

  Scenario: Correct response code is returned
    When an authenticated "delete" request is made to "/.ghost/activitypub/post/Note1"
    Then the request is accepted with a 204
    
  Scenario: Attempting to delete another user's post
    And "Alice" creates a note "AliceNote" with the content
      """
      Alice's note that we shouldn't be able to delete
      """
    When an authenticated "delete" request is made to "/.ghost/activitypub/post/AliceNote"
    Then the request is rejected with a 403
