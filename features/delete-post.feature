Feature: Delete a post

  Background:
    Given we create a note "Note" with the content
      """
      Hello
      World
      """
    Then "Note" is in our Outbox

  Scenario: Correct response code is returned
    When we delete the post "Note"
    Then the request is accepted with a 204
    
  Scenario: Attempting to delete another user's post
    Given an Actor "Person(Alice)"
    And we follow "Alice"
    And the request is accepted
    And a "Accept(Follow(Alice))" Activity "Accept" by "Alice"
    And "Alice" sends "Accept" to the Inbox
    And "Accept" is in our Inbox
    And a "Create(Note)" Activity "AliceNote" by "Alice"
    And "Alice" sends "AliceNote" to the Inbox
    And "AliceNote" is in our Inbox
    When we delete the post "AliceNote"
    Then the request is rejected with a 404
